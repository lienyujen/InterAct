import type { Answer, Question } from '../types'

type Props = {
  question: Question | null
  answer: Answer | null
  onSubmit: (value: string) => void
}

export function ParticipantQuestionView({ question, answer, onSubmit }: Props) {
  if (!question) return null

  return (
    <section className="panel participant-question">
      <h2>{question.title || '互動題'}</h2>
      {question.status !== 'active' && <p className="muted">本題已結束。</p>}
      {answer && <p className="success">已送出答案：{answer.answer_value || answer.answer_text}</p>}
      {!answer && question.status === 'active' && (
        <div className="choice-list">
          {question.options.map((option) => (
            <button key={option} type="button" onClick={() => onSubmit(option)}>
              {option}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
