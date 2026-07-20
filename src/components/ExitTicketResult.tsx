import { MessageSquareText, Star } from 'lucide-react'
import type { ExitTicket, ExitTicketCategory } from '../types'

const categoryLabels: Record<ExitTicketCategory, string> = {
  lesson_summary: '課程總結',
  learning_assessment: '學習程度評估',
  course_satisfaction: '課程建議與回饋',
  student_question: '提出疑問',
}

type Props = {
  category: ExitTicketCategory
  onlineCount: number
  prompt: string
  tickets: ExitTicket[]
}

export function ExitTicketResult({ category, onlineCount, prompt, tickets }: Props) {
  const ratings = tickets.map((ticket) => ticket.rating).filter((rating): rating is number => rating !== null)
  const average = ratings.length ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length : 0
  const distribution = [1, 2, 3, 4, 5].map((rating) => ({
    rating,
    count: ratings.filter((value) => value === rating).length,
  }))

  return (
    <section className="panel exit-ticket-result">
      <div className="panel-heading">
        <h2>Exit Ticket 作答狀態</h2>
        <span className="status active">{tickets.length}/{onlineCount || '—'}</span>
      </div>
      <div className="exit-ticket-rating-summary">
        <Star fill="currentColor" size={24} />
        <div><strong>{average ? average.toFixed(1) : '—'}</strong><span>平均學習程度</span></div>
      </div>
      <div className="rating-distribution" aria-label="星等分布">
        {distribution.map((item) => (
          <div key={item.rating}><span>{item.rating} 星</span><b>{item.count}</b></div>
        ))}
      </div>
      <div className="exit-ticket-response-heading">
        <MessageSquareText size={18} />
        <div><span>{categoryLabels[category]}</span><p>{prompt}</p></div>
      </div>
      {tickets.some((ticket) => ticket.response_text) ? (
        <ul className="exit-ticket-response-list">
          {tickets.filter((ticket) => ticket.response_text).map((ticket) => (
            <li key={ticket.id}><strong>{ticket.participant_name}</strong><span>{ticket.response_text}</span></li>
          ))}
        </ul>
      ) : <p className="muted">尚未收到文字回答。</p>}
    </section>
  )
}
