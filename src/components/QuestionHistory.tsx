import { ChevronDown, ChevronUp, Dice5, History, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Question } from '../types'

type Props = {
  questions: Question[]
  activeQuestionId: string | null
  selectedQuestionId: string | null
  answerCounts: Record<string, number>
  busy: boolean
  onlineCount: number
  onDrawUnanswered: (questionId: string) => void
  onSelect: (questionId: string) => void
}

export function QuestionHistory({
  questions,
  activeQuestionId,
  selectedQuestionId,
  answerCounts,
  busy,
  onlineCount,
  onDrawUnanswered,
  onSelect,
}: Props) {
  const [open, setOpen] = useState(false)
  const history = useMemo(
    () => questions
      .map((question, index) => ({ question, number: index + 1 }))
      .filter(({ question }) => question.id !== activeQuestionId)
      .reverse(),
    [activeQuestionId, questions],
  )

  if (!history.length) return null

  return (
    <section className="panel question-history">
      <button
        aria-expanded={open}
        className="question-history-toggle"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <History size={17} />
        <span>歷史題目</span>
        <strong>{history.length}</strong>
        {open ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
      </button>

      {open && (
        <div className="question-history-list">
          {selectedQuestionId !== activeQuestionId && activeQuestionId && (
            <button className="question-history-return" type="button" onClick={() => onSelect(activeQuestionId)}>
              <RotateCcw size={15} />回到目前題目
            </button>
          )}
          {history.map(({ question, number }) => {
            const canDrawUnanswered = question.type !== 'send_screen'
              && (question.status === 'stopped' || question.status === 'closed')
            return (
              <div className="question-history-row" key={question.id}>
                <button
                  className={`question-history-item ${selectedQuestionId === question.id ? 'selected' : ''}`}
                  type="button"
                  onClick={() => onSelect(question.id)}
                >
                  <span>第 {number} 題</span>
                  <strong>{question.prompt_text || question.title}</strong>
                  <small>{answerCounts[question.id] || 0} 份作答</small>
                </button>
                {canDrawUnanswered && (
                  <button
                    aria-label={`抽選第 ${number} 題未作答學生`}
                    className="question-history-draw"
                    disabled={busy || !onlineCount}
                    title={onlineCount ? '抽選目前在線且未作答此題的學生' : '目前沒有在線學生'}
                    type="button"
                    onClick={() => onDrawUnanswered(question.id)}
                  >
                    <Dice5 size={19} />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
