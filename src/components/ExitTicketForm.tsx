import { Send, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { ExitTicket, ExitTicketCategory } from '../types'

type Props = {
  prompt: string
  category: ExitTicketCategory
  ticket: ExitTicket | null
  busy: boolean
  onSubmit: (value: { responseText: string; rating: number }) => void
}

const categoryLabels: Record<ExitTicketCategory, string> = {
  lesson_summary: '課程總結',
  learning_assessment: '學習程度評估',
  course_satisfaction: '課程回饋',
  student_question: '提出疑問',
}

export function ExitTicketForm({ prompt, category, ticket, busy, onSubmit }: Props) {
  const [responseText, setResponseText] = useState('')
  const [rating, setRating] = useState(0)

  useEffect(() => {
    setResponseText('')
    setRating(0)
  }, [prompt])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (rating) onSubmit({ responseText: responseText.trim(), rating })
  }

  return (
    <section className="panel exit-ticket-panel">
      <div className="exit-ticket-heading">
        <h2>Exit Ticket</h2>
        <span>{categoryLabels[category]}</span>
      </div>
      {ticket ? (
        <div className="exit-ticket-submitted">
          <p className="success">Exit Ticket 已送出</p>
          <p><strong>學習程度：</strong>{ticket.rating} 顆星</p>
          <p><strong>{prompt}</strong></p>
          <p>{ticket.response_text}</p>
        </div>
      ) : (
        <form className="exit-ticket-form" onSubmit={submit}>
          <fieldset className="exit-ticket-question">
            <legend><span>必答 1</span>請用 1 到 5 顆星評估你今天的學習理解程度</legend>
            <div className="star-rating" role="radiogroup" aria-label="學習程度星等">
              {[1, 2, 3, 4, 5].map((value) => (
              <button
                aria-checked={rating === value}
                aria-label={`${value} 顆星`}
                className={value <= rating ? 'selected' : ''}
                key={value}
                role="radio"
                type="button"
                onClick={() => setRating(value)}
              >
                <Star fill={value <= rating ? 'currentColor' : 'none'} size={32} />
              </button>
              ))}
            </div>
          </fieldset>
          <label className="exit-ticket-question">
            <span className="exit-ticket-question-title"><b>選填 2</b>{prompt}</span>
            <textarea
              maxLength={2000}
              value={responseText}
              placeholder="選填：可輸入你的回答、建議或回饋"
              onChange={(event) => setResponseText(event.target.value)}
            />
          </label>
          <button disabled={busy || !rating} type="submit">
            {!busy && <Send size={18} />}
            {busy ? '送出中...' : '送出 Exit Ticket'}
          </button>
        </form>
      )}
    </section>
  )
}
