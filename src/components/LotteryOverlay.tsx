import { PartyPopper } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { SessionEvent } from '../types'

type Props = {
  event: SessionEvent | null
  participantId?: string | null
}

export function LotteryOverlay({ event, participantId }: Props) {
  const [displayedName, setDisplayedName] = useState('')
  const [revealed, setRevealed] = useState(false)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!event || (participantId && event.payload.winner_id !== participantId)) {
      setVisible(false)
      return
    }

    const names = event.payload.candidate_names.length ? event.payload.candidate_names : [event.payload.winner_name]
    setVisible(true)
    setRevealed(false)
    setDisplayedName(names[0])
    let index = 0
    const ticker = window.setInterval(() => {
      index = (index + 1) % names.length
      setDisplayedName(names[index])
    }, 85)
    const revealTimer = window.setTimeout(() => {
      window.clearInterval(ticker)
      setDisplayedName(event.payload.winner_name)
      setRevealed(true)
    }, event.payload.duration_ms)
    const hideTimer = window.setTimeout(() => setVisible(false), event.payload.duration_ms + 5200)

    return () => {
      window.clearInterval(ticker)
      window.clearTimeout(revealTimer)
      window.clearTimeout(hideTimer)
    }
  }, [event, participantId])

  if (!visible || !event) return null

  const isWinnerDevice = Boolean(participantId)
  return (
    <div className={`lottery-overlay${revealed ? ' revealed' : ''}`} aria-live="assertive">
      <div className="lottery-rays" />
      <div className="lottery-content">
        <PartyPopper size={isWinnerDevice ? 54 : 68} />
        <p>{revealed ? (isWinnerDevice ? '恭喜！' : '抽中的是') : '抽籤中'}</p>
        <strong>{isWinnerDevice && !revealed ? '請稍候...' : displayedName}</strong>
        {!isWinnerDevice && <small>第 {event.payload.round} 輪．{event.payload.candidate_count} 人參與</small>}
      </div>
      {revealed && Array.from({ length: 18 }, (_, index) => (
        <i className="celebration-piece" key={index} style={{ '--piece-index': index } as CSSProperties} />
      ))}
    </div>
  )
}
