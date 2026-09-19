import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, History, Mic2 } from 'lucide-react'
import type { ParticipantLocale } from '../lib/participantI18n'
import { ParticipantAnswerReview, Verdict } from './ParticipantAnswerReview'
import { publicFileUrl } from '../lib/fileLinks'
import type { Answer, AudioResponse, FileAnalysis, ParticipantQuizData, Question, Screenshot } from '../types'

export type SubmittedFile = {
  id: string
  name: string
  mime_type?: string | null
  storage_path?: string | null
  analysis_status: string
  analysis_json: FileAnalysis | null
}

type Props = {
  activeQuestionId?: string | null
  answers: Answer[]
  audioResponses: Record<string, AudioResponse | null>
  loadingQuestionIds: Set<string>
  locale: ParticipantLocale
  onLoadDetails: (question: Question) => Promise<void>
  questions: Question[]
  quizData: Record<string, ParticipantQuizData | null>
  // The answer to a 排序題 or 配對題, which is only readable once the
  // question has closed and so has to be fetched rather than read off the
  // question row.
  questionKeys: Record<string, string[]>
  // What this student handed in for an upload or a 電寫題, fetched the same way.
  submittedFiles: Record<string, SubmittedFile[]>
  screenshots: Record<string, Screenshot>
}

function questionTitle(question: Question, locale: ParticipantLocale) {
  const translation = locale === 'en' ? question.translations?.en : undefined
  return translation?.prompt_text || translation?.title || question.prompt_text || translation?.title || question.title
}

export function ParticipantQuestionHistory({
  activeQuestionId,
  answers,
  audioResponses,
  loadingQuestionIds,
  locale,
  onLoadDetails,
  questions,
  questionKeys,
  quizData,
  screenshots,
  submittedFiles,
}: Props) {
  const history = useMemo(() => questions.filter((item) => item.id !== activeQuestionId).slice().reverse(), [activeQuestionId, questions])
  const [sectionExpanded, setSectionExpanded] = useState(true)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const newestId = history[0]?.id || ''

  useEffect(() => {
    if (!newestId) return
    setOpenIds((current) => current.has(newestId) ? current : new Set([newestId]))
  }, [newestId])

  if (!history.length) return null
  const english = locale === 'en'

  async function toggleQuestion(question: Question) {
    const opening = !openIds.has(question.id)
    setOpenIds((current) => {
      const next = new Set(current)
      if (opening) next.add(question.id)
      else next.delete(question.id)
      return next
    })
    if (opening) await onLoadDetails(question)
  }

  return (
    <section className="participant-history-section" aria-label={english ? 'Answered questions' : '已作答題目'}>
      <div className="participant-history-heading">
        <div><History size={19} /><h2>{english ? 'Answered questions' : '已作答題目'}</h2></div>
        <button className="ghost-button" type="button" aria-expanded={sectionExpanded} onClick={() => setSectionExpanded((current) => !current)}>
          {sectionExpanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
          {sectionExpanded ? (english ? 'Collapse' : '收合') : `${english ? 'Expand' : '展開'} ${history.length}`}
        </button>
      </div>
      {sectionExpanded && (
        <div className="participant-history-list">
          {history.map((question, index) => {
            const open = openIds.has(question.id)
            const answer = answers.find((item) => item.question_id === question.id)
            const screenshot = question.screenshot_id ? screenshots[question.screenshot_id] : null
            const audio = audioResponses[question.id]
            const quiz = quizData[question.id]
            const loading = loadingQuestionIds.has(question.id)
            return (
              <article className="participant-history-item" key={question.id}>
                <button className="participant-history-toggle" type="button" aria-expanded={open} onClick={() => void toggleQuestion(question)}>
                  <span>{english ? `Question ${history.length - index}` : `第 ${history.length - index} 題`}</span>
                  <strong>{questionTitle(question, locale)}</strong>
                  {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </button>
                {open && (
                  <div className="participant-history-body">
                    {/* 圖上點選 draws the same picture with the taps on it, so
                        showing it here as well would print it twice. */}
                    {screenshot && question.type !== 'hotspot' && <img alt={english ? 'Dispatched question' : '派送題目'} src={screenshot.public_url} />}
                    {(question.type === 'file_upload' || question.type === 'drawing') && (
                      <SubmissionReview
                        drawn={question.type === 'drawing'}
                        files={submittedFiles[question.id] || []}
                        locale={locale}
                      />
                    )}
                    {loading && <p className="muted"><Clock3 size={16} />{english ? 'Loading your answer…' : '正在載入你的作答…'}</p>}
                    {question.type === 'custom_quiz' ? (quiz?.attempt ? (
                      <div className="participant-history-quiz">
                        <p><CheckCircle2 size={17} />{english ? 'Submitted score' : '作答分數'}：{quiz.attempt.total_score ?? '-'}/{quiz.attempt.max_score}</p>
                        {quiz.items.map((item, itemIndex) => {
                          const response = quiz.answers.find((entry) => entry.item_id === item.id)
                          const prompt = locale === 'en' ? item.translations?.en?.prompt_text || item.prompt_text : item.prompt_text
                          const submitted = response?.answer_values?.join(', ') || response?.answer_text || ''
                          const feedback = locale === 'en' ? response?.feedback?.en || response?.feedback?.zh_tw : response?.feedback?.zh_tw
                          // Sent only once the quiz has closed; empty while it is open.
                          const accepted = quiz.keys?.find((key) => key.item_id === item.id)?.accepted_answers || []
                          // A score of full marks on an item is the only
                          // thing that says "right" here, because an item
                          // can be partly credited.
                          const scored = typeof response?.score === 'number' ? response.score : null
                          return (
                            <div className="participant-review-item" key={item.id}>
                              <strong>{itemIndex + 1}. {prompt}</strong>
                              {scored !== null && <Verdict correct={scored >= item.points} locale={locale} />}
                              <p className="participant-review-line">
                                <span className="participant-review-label">{english ? 'Your answer' : '你的答案'}</span>
                                <strong>{submitted || (english ? '(blank)' : '（未作答）')}</strong>
                              </p>
                              {accepted.length > 0 && (
                                <p className="participant-review-line">
                                  <span className="participant-review-label">{english ? 'Correct answer' : '正確答案'}</span>
                                  <strong>{accepted.join(english ? ', ' : '、')}</strong>
                                </p>
                              )}
                              {scored !== null && <small>{english ? 'Score' : '得分'}：{scored}/{item.points}</small>}
                              {feedback && <small>{feedback}</small>}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      // Never the generic line for this type: the answers row
                      // holds an internal placeholder, not anything a student
                      // wrote.
                      <p className="muted">{english ? 'Your quiz answers could not be loaded. Please reopen this question.' : '讀不到你的測驗作答，請再展開一次這一題。'}</p>
                    )) : question.type === 'pronunciation' || question.type === 'oral_response' ? (
                      audio && <div className="participant-history-audio">
                        <p><Mic2 size={17} />{english ? 'Recording submitted' : '已送出錄音'}{audio.score !== null ? ` · ${audio.score} ${english ? 'points' : '分'}` : ''}</p>
                        {audio.signed_url && <audio controls preload="metadata" src={audio.signed_url} />}
                        {audio.analysis_json?.summary && <p>{locale === 'en' ? audio.analysis_json.translations?.en?.summary || audio.analysis_json.summary : audio.analysis_json.summary}</p>}
                        {audio.transcript && <small>{english ? 'Transcript' : '逐字稿'}：{audio.transcript}</small>}
                      </div>
                    ) : question.type === 'file_upload' || question.type === 'drawing' ? null : answer ? (
                      <ParticipantAnswerReview
                        answer={answer}
                        correctValues={questionKeys[question.id] || []}
                        locale={locale}
                        question={question}
                        screenshot={screenshot || null}
                      />
                    ) : null}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

// An upload and a 電寫題 both answer with a page rather than with words, so
// this is the review for both: the page itself, and the marking if the teacher
// has run it. Without it the history would show the placeholder that the
// answers row carries, which tells a student nothing about what they wrote.
function SubmissionReview({ drawn, files, locale }: {
  drawn: boolean
  files: SubmittedFile[]
  locale: ParticipantLocale
}) {
  const english = locale === 'en'
  const images = files.filter((file) => file.storage_path)
  // Pages of one submission share one mark, so it is shown once.
  const marked = files.find((file) => file.analysis_status === 'success' && file.analysis_json)
  const result = marked?.analysis_json || null

  if (!files.length) {
    return <p className="muted">{english ? 'You did not hand anything in for this one.' : '這一題你沒有交作答。'}</p>
  }

  return (
    <div className="participant-review">
      <span className="participant-review-label">{english ? 'What you handed in' : '你送出的作答'}</span>
      {images.length > 0 ? (
        <div className="participant-review-tiles">
          {images.map((file) => (
            <img alt={file.name} key={file.id} src={publicFileUrl(file.storage_path as string)} />
          ))}
        </div>
      ) : (
        <p className="muted">{files.map((file) => file.name).join('、')}</p>
      )}
      {result ? (
        <div className="participant-mark">
          {typeof result.score === 'number' && (
            <p className="participant-mark-score">{result.score}{english ? ' points' : ' 分'}</p>
          )}
          <p>{english ? result.summary_en : result.summary_zh_tw}</p>
          {(english ? result.improvements_en : result.improvements_zh_tw).length > 0 && (
            <ul>
              {(english ? result.improvements_en : result.improvements_zh_tw).map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="muted">
          {drawn
            ? english ? 'Your teacher has not marked this yet.' : '老師還沒批改這一張。'
            : english ? 'Your teacher has not marked this yet.' : '老師還沒批改這一份。'}
        </p>
      )}
    </div>
  )
}
