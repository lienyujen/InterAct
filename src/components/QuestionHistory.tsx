import { ChevronDown, ChevronUp, History, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Question } from '../types'

type Props = {
  questions: Question[]
  activeQuestionId: string | null
  selectedQuestionId: string | null
  answerCounts: Record<string, number>
  onSelect: (questionId: string) => void
}

export function QuestionHistory({ questions, activeQuestionId, selectedQuestionId, answerCounts, onSelect }: Props) {
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
          {history.map(({ question, number }) => (
            <button
              className={`question-history-item ${selectedQuestionId === question.id ? 'selected' : ''}`}
              key={question.id}
              type="button"
              onClick={() => onSelect(question.id)}
            >
              <span>第 {number} 題</span>
              <strong>{question.prompt_text || question.title}</strong>
              <small>{answerCounts[question.id] || 0} 份作答</small>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
