import { Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { ExitTicket, ExitTicketCategory, ExitTicketResponseType } from '../types'

type Props = {
  prompt: string
  category: ExitTicketCategory
  responseType: ExitTicketResponseType
  ticket: ExitTicket | null
  busy: boolean
  onSubmit: (value: { responseText: string | null; rating: number | null }) => void
}

const categoryLabels: Record<ExitTicketCategory, string> = {
  lesson_summary: '課程總結',
  learning_assessment: '學習程度評估',
  course_satisfaction: '課程回饋',
  student_question: '提出疑問',
}

export function ExitTicketForm({ prompt, category, responseType, ticket, busy, onSubmit }: Props) {
  const [responseText, setResponseText] = useState('')
  const [rating, setRating] = useState(0)

  useEffect(() => {
    setResponseText('')
    setRating(0)
  }, [prompt])

  function submit(event: FormEvent) {
    event.preventDefault()
    if (responseType === 'rating' && rating) onSubmit({ responseText: null, rating })
    if (responseType === 'text' && responseText.trim()) onSubmit({ responseText: responseText.trim(), rating: null })
  }

  const submittedValue = ticket?.rating
    ? `${ticket.rating} 顆星`
    : ticket?.response_text || ticket?.most_useful

  return (
    <section className="panel exit-ticket-panel">
      <div className="exit-ticket-heading">
        <h2>Exit Ticket</h2>
        <span>{categoryLabels[category]}</span>
      </div>
      <p className="exit-ticket-prompt">{prompt}</p>
      {ticket ? (
        <p className="success">已送出：{submittedValue}</p>
      ) : (
        <form className="exit-ticket-form" onSubmit={submit}>
          {responseType === 'rating' ? (
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
          ) : (
            <textarea
              value={responseText}
              placeholder="請輸入你的回答"
              onChange={(event) => setResponseText(event.target.value)}
            />
          )}
          <button disabled={busy || (responseType === 'rating' ? !rating : !responseText.trim())} type="submit">
            {busy ? '送出中...' : '送出 Exit Ticket'}
          </button>
        </form>
      )}
    </section>
  )
}
