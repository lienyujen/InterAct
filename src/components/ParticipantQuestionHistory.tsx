import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, History, Mic2 } from 'lucide-react'
import type { ParticipantLocale } from '../lib/participantI18n'
import { isImageValue } from '../lib/sliceImage'
import type { Answer, AudioResponse, ParticipantQuizData, Question, Screenshot } from '../types'

type Props = {
  activeQuestionId?: string | null
  answers: Answer[]
  audioResponses: Record<string, AudioResponse | null>
  loadingQuestionIds: Set<string>
  locale: ParticipantLocale
  onLoadDetails: (question: Question) => Promise<void>
  questions: Question[]
  quizData: Record<string, ParticipantQuizData | null>
  screenshots: Record<string, Screenshot>
}

function answerText(question: Question, answer: Answer, locale: ParticipantLocale) {
  const translatedOptions = locale === 'en' && question.translations?.en?.options?.length === question.options.length
    ? question.translations.en.options
    : question.options
  const display = (value: string) => {
    const index = question.options.indexOf(value)
    return index >= 0 ? translatedOptions[index] : value
  }
  if (answer.answer_values?.length) {
    // Tiles cut out of a screenshot have no text to read back; the student saw
    // the pieces, and a list of storage paths tells them nothing.
    if (answer.answer_values.some(isImageValue)) {
      return locale === 'en' ? `${answer.answer_values.length} pieces, in the order you set` : `${answer.answer_values.length} 塊，依你排的順序`
    }
    return answer.answer_values.map(display).join(locale === 'en' ? ', ' : '、')
  }
  if (answer.answer_value) return display(answer.answer_value)
  return answer.answer_text || ''
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
  quizData,
  screenshots,
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
                    {screenshot && <img alt={english ? 'Dispatched question' : '派送題目'} src={screenshot.public_url} />}
                    {loading && <p className="muted"><Clock3 size={16} />{english ? 'Loading your answer…' : '正在載入你的作答…'}</p>}
                    {question.type === 'custom_quiz' && quiz?.attempt ? (
                      <div className="participant-history-quiz">
                        <p><CheckCircle2 size={17} />{english ? 'Submitted score' : '作答分數'}：{quiz.attempt.total_score ?? '-'}/{quiz.attempt.max_score}</p>
                        {quiz.items.map((item, itemIndex) => {
                          const response = quiz.answers.find((entry) => entry.item_id === item.id)
                          const prompt = locale === 'en' ? item.translations?.en?.prompt_text || item.prompt_text : item.prompt_text
                          const submitted = response?.answer_values?.join(', ') || response?.answer_text || '-'
                          const feedback = locale === 'en' ? response?.feedback?.en || response?.feedback?.zh_tw : response?.feedback?.zh_tw
                          return <div key={item.id}><strong>{itemIndex + 1}. {prompt}</strong><p>{english ? 'Your answer' : '你的答案'}：{submitted}</p>{feedback && <small>{feedback}</small>}</div>
                        })}
                      </div>
                    ) : question.type === 'pronunciation' || question.type === 'oral_response' ? (
                      audio && <div className="participant-history-audio">
                        <p><Mic2 size={17} />{english ? 'Recording submitted' : '已送出錄音'}{audio.score !== null ? ` · ${audio.score} ${english ? 'points' : '分'}` : ''}</p>
                        {audio.signed_url && <audio controls preload="metadata" src={audio.signed_url} />}
                        {audio.analysis_json?.summary && <p>{locale === 'en' ? audio.analysis_json.translations?.en?.summary || audio.analysis_json.summary : audio.analysis_json.summary}</p>}
                        {audio.transcript && <small>{english ? 'Transcript' : '逐字稿'}：{audio.transcript}</small>}
                      </div>
                    ) : answer ? (
                      <p className="participant-history-answer"><CheckCircle2 size={17} />{english ? 'Your answer' : '你的答案'}：<strong>{answerText(question, answer, locale)}</strong></p>
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
