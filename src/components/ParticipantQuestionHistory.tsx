import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, History, Mic2 } from 'lucide-react'
import type { ParticipantLocale } from '../lib/participantI18n'
import { ParticipantAnswerReview, Verdict } from './ParticipantAnswerReview'
import { FileTypeIcon } from './FileTypeIcon'
import { isImageFileName } from '../lib/fileKinds'
import { downloadHref, publicFileUrl } from '../lib/fileLinks'
import type { Answer, AudioResponse, FileAnalysis, ParticipantQuizData, Question, QuestionAnalysis, Screenshot } from '../types'

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
  // What the AI read the question as, and what it thought the answer was.
  // Kept per question so it stays with the answer it belongs to.
  analyses: Record<string, QuestionAnalysis>
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
  analyses,
  quizData,
  screenshots,
  submittedFiles,
}: Props) {
  const history = useMemo(() => questions.filter((item) => item.id !== activeQuestionId).slice().reverse(), [activeQuestionId, questions])
  const [sectionExpanded, setSectionExpanded] = useState(true)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const newestId = history[0]?.id || ''

  // Once per question, so a loader whose identity changes when it stores what
  // it fetched cannot send this round again.
  const autoLoaded = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!newestId || autoLoaded.current.has(newestId)) return
    autoLoaded.current.add(newestId)
    setOpenIds((current) => current.has(newestId) ? current : new Set([newestId]))
    const newest = history.find((item) => item.id === newestId)
    if (newest) void onLoadDetails(newest)
  }, [history, newestId, onLoadDetails])

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
            const analysis = analyses[question.id]?.question_understanding
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
                        files={submittedFiles[question.id]}
                        locale={locale}
                        onReload={() => onLoadDetails(question)}
                      />
                    )}
                    {loading && <p className="muted"><Clock3 size={16} />{english ? 'Loading your answer…' : '正在載入你的作答…'}</p>}
                    {question.type === 'custom_quiz' && quiz === undefined ? null
                      : (question.type === 'pronunciation' || question.type === 'oral_response') && audio === undefined ? null
                      : question.type === 'custom_quiz' ? (quiz?.attempt ? (
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
                      audio ? <div className="participant-history-audio">
                        <p><Mic2 size={17} />{english ? 'Recording submitted' : '已送出錄音'}{audio.score !== null ? ` · ${audio.score} ${english ? 'points' : '分'}` : ''}</p>
                        {audio.signed_url && <audio controls preload="metadata" src={audio.signed_url} />}
                        {audio.analysis_json?.summary && <p>{locale === 'en' ? audio.analysis_json.translations?.en?.summary || audio.analysis_json.summary : audio.analysis_json.summary}</p>}
                        {audio.analysis_json?.strengths?.length ? (
                          <>
                            <h4>{english ? 'Done well' : '做得好'}</h4>
                            <ul>{audio.analysis_json.strengths.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                          </>
                        ) : null}
                        {audio.analysis_json?.improvements?.length ? (
                          <>
                            <h4>{english ? 'To improve' : '可改進'}</h4>
                            <ul>{audio.analysis_json.improvements.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                          </>
                        ) : null}
                        {audio.transcript && <small>{english ? 'Transcript' : '逐字稿'}：{audio.transcript}</small>}
                      </div> : (
                        <p className="muted">{english ? 'You did not record anything for this one.' : '這一題你沒有送出錄音。'}</p>
                      )
                    ) : question.type === 'file_upload' || question.type === 'drawing' ? null : answer ? (
                      <ParticipantAnswerReview
                        answer={answer}
                        correctValues={questionKeys[question.id] || []}
                        locale={locale}
                        question={question}
                        screenshot={screenshot || null}
                      />
                    ) : null}
                    {/* Sits below what the student handed in, never instead of
                        it: this is what the AI made of the question, and it is
                        worth reading precisely because their own answer is
                        still there above it to compare against. */}
                    {analysis && (analysis.detected_question || analysis.suggested_correct_answer) && (
                      <div className="participant-ai-answer">
                        <p className="eyebrow">{english ? 'What the AI made of this' : 'AI 對這一題的判讀'}</p>
                        {analysis.detected_question && <p>{analysis.detected_question}</p>}
                        {analysis.suggested_correct_answer && (
                          <p className="participant-ai-suggested">
                            <span className="participant-review-label">{english ? 'Suggested answer' : 'AI 建議答案'}</span>
                            <strong>{analysis.suggested_correct_answer}</strong>
                          </p>
                        )}
                        {analysis.reasoning && <small>{analysis.reasoning}</small>}
                      </div>
                    )}
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

const submissionVerdicts: Record<string, { 'zh-TW': string; en: string }> = {
  correct: { 'zh-TW': '正確', en: 'Correct' },
  partial: { 'zh-TW': '部分正確', en: 'Partly correct' },
  incorrect: { 'zh-TW': '不正確', en: 'Incorrect' },
  unscored: { 'zh-TW': '已批閱', en: 'Reviewed' },
}

// An upload and a 電寫題 both answer with a page rather than with words, so
// this is the review for both: the page itself, and the marking if the teacher
// has run it. Without it the history would show the placeholder that the
// answers row carries, which tells a student nothing about what they wrote.
//
// `files` is undefined until it has been fetched, and that is not the same as
// an empty array. Treating the two alike told students who had handed in that
// they had not.
function SubmissionReview({ drawn, files, locale, onReload }: {
  drawn: boolean
  files: SubmittedFile[] | undefined
  locale: ParticipantLocale
  onReload: () => Promise<void>
}) {
  const english = locale === 'en'
  const marked = files?.find((file) => file.analysis_status === 'success' && file.analysis_json)
  const result = marked?.analysis_json || null

  // The mark lands whenever the teacher gets to it, which is usually minutes
  // after the question closed and while this page is still open. Held in a ref
  // so a loader that changes identity as it stores what it fetched does not
  // restart the clock on every render.
  const reload = useRef(onReload)
  reload.current = onReload
  useEffect(() => {
    if (result) return
    // Only while somebody is looking: a phone in a pocket asking every fifteen
    // seconds for a mark nobody is waiting to read is the sort of thing that
    // shows up as battery rather than as a bug.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload.current()
    }, 15_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void reload.current() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [result])

  if (files === undefined) {
    return <p className="muted"><Clock3 size={16} />{english ? 'Loading what you handed in…' : '正在載入你的作答…'}</p>
  }
  if (!files.length) {
    return <p className="muted">{english ? 'You did not hand anything in for this one.' : '這一題你沒有交作答。'}</p>
  }

  const stored = files.filter((file) => file.storage_path)
  const images = stored.filter((file) => isImageFileName(file.name, file.mime_type))
  const others = stored.filter((file) => !isImageFileName(file.name, file.mime_type))
  const verdict = result?.verdict ? submissionVerdicts[result.verdict] : null
  const strengths = result ? (english ? result.strengths_en : result.strengths_zh_tw) : []
  const improvements = result ? (english ? result.improvements_en : result.improvements_zh_tw) : []

  return (
    <div className="participant-review">
      <span className="participant-review-label">{english ? 'What you handed in' : '你送出的作答'}</span>
      {images.length > 0 && (
        // Full width, not a tile: this is the student's own handwriting, and a
        // 72px thumbnail of it is not something anyone can read.
        <div className="participant-review-pages">
          {images.map((file) => (
            <img alt={file.name} key={file.id} src={publicFileUrl(file.storage_path as string)} />
          ))}
        </div>
      )}
      {others.length > 0 && (
        <ul className="participant-review-files">
          {others.map((file) => (
            <li key={file.id}>
              <a
                download
                href={downloadHref(publicFileUrl(file.storage_path as string), file.name)}
                rel="noreferrer"
                target="_blank"
              >
                <FileTypeIcon mimeType={file.mime_type} name={file.name} />
                {file.name}
              </a>
            </li>
          ))}
        </ul>
      )}
      {result ? (
        <div className="participant-mark">
          <div className="participant-mark-headline">
            {verdict && <span className={`file-verdict is-${result.verdict}`}>{verdict[locale]}</span>}
            {typeof result.score === 'number' && (
              <span className="participant-mark-score">{result.score}{english ? ' points' : ' 分'}</span>
            )}
          </div>
          <p>{english ? result.summary_en : result.summary_zh_tw}</p>
          {strengths.length > 0 && (
            <>
              <h4>{english ? 'Done well' : '做得好'}</h4>
              <ul>{strengths.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </>
          )}
          {improvements.length > 0 && (
            <>
              <h4>{english ? 'To improve' : '可改進'}</h4>
              <ul>{improvements.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </>
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
