import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, LogIn, Presentation } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { SetupNotice } from '../components/SetupNotice'

export function HomePage() {
  const [sessionId, setSessionId] = useState('')
  const navigate = useNavigate()

  function join(event: FormEvent) {
    event.preventDefault()
    const value = sessionId.trim()
    if (value) navigate(`/join/${value}`)
  }

  return (
    <main className="home-page">
      <SetupNotice />
      <section className="home-content">
        <p className="eyebrow">Intelligent Teaching, Engagement, Response and Classroom Technology</p>
        <h1>InterAct 即時互動教學系統</h1>
        <p className="lede">建立場次、顯示 QR Code、收集現場提問，並用彈幕和選擇題讓教學現場動起來。</p>
        <div className="home-actions">
          <Link className="primary-link" to="/presenter/new">
            <Presentation size={19} />建立新場次
          </Link>
          <form className="join-form" onSubmit={join}>
            <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="輸入 session id" />
            <button type="submit"><LogIn size={18} />加入場次<ArrowRight size={17} /></button>
          </form>
        </div>
      </section>
    </main>
  )
}
