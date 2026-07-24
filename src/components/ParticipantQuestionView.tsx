import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Send } from 'lucide-react'
import type { Answer, Question } from '../types'

type Props = {
  question: Question | null
  answer: Answer | null
  onSubmit: (value: string | string[]) => void
}

export function ParticipantQuestionView({ question, answer, onSubmit }: Props) {
  const [textAnswer, setTextAnswer] = useState('')
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])

  useEffect(() => {
    setTextAnswer('')
    setSelectedOptions([])
  }, [question?.id])

  if (!question || question.type === 'send_screen') return null

  function submitShortAnswer(event: FormEvent) {
    event.preventDefault()
    const value = textAnswer.trim()
    if (value) onSubmit(value)
  }

  return (
    <section className="panel participant-question">
      <h2>{question.prompt_text || question.title || '互動題'}</h2>
      {question.status !== 'active' && <p className="muted">本題已結束。</p>}
      {answer && <p className="success">已送出答案：{answer.answer_values?.join('、') || answer.answer_value || answer.answer_text}</p>}
      {!answer && question.status === 'active' && question.type === 'short_answer' && (
        <form className="short-answer-form" onSubmit={submitShortAnswer}>
          <textarea value={textAnswer} onChange={(event) => setTextAnswer(event.target.value)} placeholder="請輸入你的回答" />
          <button type="submit"><Send size={18} />送出答案</button>
        </form>
      )}
      {!answer && question.status === 'active' && question.type !== 'short_answer' && question.allow_multiple && (
        <form
          className="multi-choice-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (selectedOptions.length) onSubmit(selectedOptions)
          }}
        >
          <div className="multi-choice-list">
            {question.options.map((option) => {
              const selected = selectedOptions.includes(option)
              return (
                <label className={`multi-choice-option${selected ? ' selected' : ''}`} key={option}>
                  <input
                    checked={selected}
                    type="checkbox"
                    onChange={() => {
                      setSelectedOptions((current) =>
                        current.includes(option) ? current.filter((value) => value !== option) : [...current, option],
                      )
                    }}
                  />
                  <span>{option}</span>
                </label>
              )
            })}
          </div>
          <button disabled={!selectedOptions.length} type="submit"><Send size={18} />送出答案</button>
        </form>
      )}
      {!answer && question.status === 'active' && question.type !== 'short_answer' && !question.allow_multiple && (
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
