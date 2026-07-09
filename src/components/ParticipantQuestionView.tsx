import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Answer, Question } from '../types'

type Props = {
  question: Question | null
  answer: Answer | null
  onSubmit: (value: string) => void
}

export function ParticipantQuestionView({ question, answer, onSubmit }: Props) {
  const [textAnswer, setTextAnswer] = useState('')

  if (!question || question.type === 'send_screen') return null

  function submitShortAnswer(event: FormEvent) {
    event.preventDefault()
    const value = textAnswer.trim()
    if (value) onSubmit(value)
  }

  return (
    <section className="panel participant-question">
      <h2>{question.title || '互動題'}</h2>
      {question.status !== 'active' && <p className="muted">本題已結束。</p>}
      {answer && <p className="success">已送出答案：{answer.answer_value || answer.answer_text}</p>}
      {!answer && question.status === 'active' && question.type === 'short_answer' && (
        <form className="short-answer-form" onSubmit={submitShortAnswer}>
          <textarea value={textAnswer} onChange={(event) => setTextAnswer(event.target.value)} placeholder="請輸入你的回答" />
          <button type="submit">送出答案</button>
        </form>
      )}
      {!answer && question.status === 'active' && question.type !== 'short_answer' && (
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
