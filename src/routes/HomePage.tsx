import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, LogIn } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
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
        <p className="lede">請掃描講師提供的 QR Code，或輸入場次代碼加入互動課堂。</p>
        <div className="home-actions">
          <form className="join-form" onSubmit={join}>
            <input value={sessionId} onChange={(event) => setSessionId(event.target.value)} placeholder="輸入場次代碼" />
            <button type="submit"><LogIn size={18} />加入場次<ArrowRight size={17} /></button>
          </form>
        </div>
      </section>
    </main>
  )
}
