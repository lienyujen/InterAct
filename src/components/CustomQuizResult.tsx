import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { BrainCircuit, Check, Clock3, Maximize2, Save, X } from 'lucide-react'
import type { PresenterQuizResults, Question } from '../types'

type Props = {
  anonymousEnabled: boolean
  question: Question
  results: PresenterQuizResults | null
  onlineCount: number
  onUpdateAnswer: (itemId: string, acceptedAnswers: string[]) => Promise<void>
}

export type QuizReviewProps = {
  // Hidden by default: the presenter reviews these on a screen the class can see.
  showAnswers: boolean
  busyItemId: string
  draftAnswers: Record<string, string>
  results: PresenterQuizResults
  onDraftChange: (itemId: string, value: string) => void
  onUpdateAnswer: (itemId: string, acceptedAnswers: string[]) => Promise<void>
}

function acceptedAnswersFor(results: PresenterQuizResults, itemId: string) {
  return results.keys.find((key) => key.item_id === itemId)?.accepted_answers || []
}

export function QuizAnswerEditor({ showAnswers, busyItemId, draftAnswers, results, onDraftChange, onUpdateAnswer }: QuizReviewProps) {
  return (
    <div className="presenter-quiz-review-list">
      {results.items.map((item, index) => {
        const acceptedAnswers = acceptedAnswersFor(results, item.id)
        return (
          <article className="presenter-quiz-review-item" key={item.id}>
            <div className="presenter-quiz-question-heading">
              <span>{index + 1}</span>
              <strong>{item.prompt_text}</strong>
              <small>{item.points} 分</small>
            </div>
            {item.type === 'multiple_choice' ? (
              <div className="presenter-quiz-options">
                {item.options.map((option) => {
                  const selected = showAnswers && acceptedAnswers.includes(option)
                  return (
                    <button
                      className={selected ? 'selected' : ''}
                      disabled={busyItemId === item.id}
                      key={option}
                      type="button"
                      onClick={() => void onUpdateAnswer(item.id, [option])}
                    >
                      <span className="presenter-answer-marker">{selected && <Check size={16} />}</span>
                      <span>{option}</span>
                    </button>
                  )
                })}
              </div>
            ) : !showAnswers ? (
              <p className="muted presenter-answer-hidden">參考答案已隱藏，勾選「顯示正確答案」即可檢視與修改。</p>
            ) : (
              <div className="presenter-reference-answer">
                <label htmlFor={`quiz-key-${item.id}`}>參考答案（每行一個可接受答案）</label>
                <textarea
                  id={`quiz-key-${item.id}`}
                  value={draftAnswers[item.id] ?? acceptedAnswers.join('\n')}
                  onChange={(event) => onDraftChange(item.id, event.target.value)}
                />
                <button
                  disabled={busyItemId === item.id || !(draftAnswers[item.id] ?? acceptedAnswers.join('\n')).trim()}
                  type="button"
                  onClick={() => void onUpdateAnswer(item.id, (draftAnswers[item.id] ?? acceptedAnswers.join('\n')).split('\n').map((answer) => answer.trim()).filter(Boolean))}
                >
                  <Save size={16} />儲存參考答案
                </button>
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}

export function CustomQuizResult({ anonymousEnabled, question, results, onlineCount, onUpdateAnswer }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [busyItemId, setBusyItemId] = useState('')
  const [error, setError] = useState('')
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({})
  // Off by default: this panel is on the screen the class is looking at.
  const [showAnswers, setShowAnswers] = useState(false)

  useEffect(() => {
    if (!expanded) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [expanded])

  if (!results) {
    return <section className="panel result-panel"><p className="muted">正在載入自訂測驗...</p></section>
  }
  if (!results.quiz) {
    return <section className="panel result-panel"><p className="muted">AI 正在出題中，請稍候...</p></section>
  }
  const graded = results.attempts.filter((attempt) => attempt.status === 'graded')
  const grading = results.attempts.filter((attempt) => attempt.status === 'grading')
  const average = graded.length
    ? graded.reduce((sum, attempt) => sum + (attempt.total_score || 0), 0) / graded.length
    : null

  async function updateAnswer(itemId: string, acceptedAnswers: string[]) {
    setBusyItemId(itemId)
    setError('')
    try {
      await onUpdateAnswer(itemId, acceptedAnswers)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '正確答案更新失敗。')
    } finally {
      setBusyItemId('')
    }
  }

  const reviewProps: QuizReviewProps = {
    showAnswers,
    busyItemId,
    draftAnswers,
    results,
    onDraftChange: (itemId, value) => setDraftAnswers((current) => ({ ...current, [itemId]: value })),
    onUpdateAnswer: updateAnswer,
  }

  function openExpandedReview() {
    if (window.interactDesktop) {
      void window.interactDesktop.openCustomQuizReview(question.session_id, question.id)
      return
    }
    setExpanded(true)
  }

  return (
    <section className="panel result-panel custom-quiz-result">
      <div className="result-heading">
        <div><p className="eyebrow"><BrainCircuit size={17} />自訂測驗</p><h2>{results.quiz.title || question.title}</h2></div>
        <div className="custom-quiz-heading-actions">
          <span>{results.attempts.length}/{onlineCount} 人作答</span>
          <button aria-label="放大檢視測驗" className="icon-button" title="放大檢視測驗" type="button" onClick={openExpandedReview}><Maximize2 size={20} /></button>
        </div>
      </div>
      <div className="quiz-result-stats">
        <div><strong>{results.items.length}</strong><span>題</span></div>
        <div><strong>{average === null ? '—' : average.toFixed(1)}</strong><span>平均分數</span></div>
        <div><strong>{grading.length}</strong><span>評分中</span></div>
      </div>
      <label className="show-answers-toggle">
        <input checked={showAnswers} type="checkbox" onChange={(event) => setShowAnswers(event.target.checked)} />
        顯示正確答案，若 AI 錯判答案請自行更正
      </label>
      {error && <p className="error">{error}</p>}
      <div className="presenter-quiz-inline-review"><QuizAnswerEditor {...reviewProps} /></div>
      {grading.length > 0 && <p className="quiz-grading-note"><Clock3 size={16} />AI 正在背景評分，完成後會自動更新。</p>}
      <div className="quiz-attempt-list">
        {results.attempts.map((attempt, index) => (
          <article key={attempt.id}>
            <div><strong>{anonymousEnabled ? `匿名學員 ${index + 1}` : attempt.participant_name}</strong><span>{attempt.status === 'graded' ? `${attempt.total_score}/${attempt.max_score}` : attempt.status === 'failed' ? '評分失敗' : '評分中'}</span></div>
            {attempt.feedback?.zh_tw && <p>{attempt.feedback.zh_tw}</p>}
          </article>
        ))}
        {!results.attempts.length && <p className="muted">尚無學員作答。</p>}
      </div>
      {expanded && createPortal(
        <div className="custom-quiz-review-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false) }}>
          <section aria-label="自訂測驗放大檢視" aria-modal="true" className="custom-quiz-review-modal" role="dialog">
            <header>
              <div><p className="eyebrow"><BrainCircuit size={17} />自訂測驗檢視與答案調整</p><h2>{results.quiz.title || question.title}</h2></div>
              <button aria-label="關閉放大視窗" className="icon-button" title="關閉" type="button" onClick={() => setExpanded(false)}><X size={22} /></button>
            </header>
            <div className={`custom-quiz-review-content${results.screenshot ? '' : ' is-single'}`}>
              {results.screenshot && (
                <aside className="custom-quiz-source-panel">
                  <h3>原始截圖</h3>
                  <img alt="自訂測驗原始截圖" src={results.screenshot.public_url} />
                </aside>
              )}
              <div className="custom-quiz-question-panel">
                <h3>題目與正確答案</h3>
                <label className="show-answers-toggle">
                  <input checked={showAnswers} type="checkbox" onChange={(event) => setShowAnswers(event.target.checked)} />
                  顯示正確答案，若 AI 錯判答案請自行更正
                </label>
                {error && <p className="error">{error}</p>}
                <QuizAnswerEditor {...reviewProps} />
              </div>
            </div>
          </section>
        </div>,
        document.body,
      )}
    </section>
  )
}
