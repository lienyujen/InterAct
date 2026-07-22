import { PartyPopper, Zap } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import { isBuzzerAccepting } from '../lib/buzzer'
import type { BuzzerSessionEvent } from '../types'

type Props = {
  event: BuzzerSessionEvent | null
  participantId?: string | null
  busy?: boolean
  onStart?: () => Promise<void> | void
  onBuzz?: () => Promise<void> | void
}

const RESULT_DURATION_MS = 6000

export function BuzzerOverlay({ event, participantId, busy = false, onStart, onBuzz }: Props) {
  const [visible, setVisible] = useState(false)
  const [pressed, setPressed] = useState(false)

  useEffect(() => {
    setPressed(false)
    if (!event || event.payload.cancelled) {
      setVisible(false)
      return
    }

    setVisible(true)
    if (!event.payload.finalized) {
      const expiresAt = event.payload.expires_at ? Date.parse(event.payload.expires_at) : 0
      const remaining = expiresAt - Date.now()
      if (!Number.isFinite(expiresAt) || remaining <= 0) {
        setVisible(false)
        return
      }
      const timer = window.setTimeout(() => setVisible(false), remaining)
      return () => window.clearTimeout(timer)
    }

    const finalizedAt = event.payload.finalized_at ? Date.parse(event.payload.finalized_at) : Date.now()
    const remaining = Math.max(0, RESULT_DURATION_MS - (Date.now() - finalizedAt))
    if (!remaining) {
      setVisible(false)
      return
    }
    const timer = window.setTimeout(() => setVisible(false), remaining)
    return () => window.clearTimeout(timer)
  }, [event])

  if (!visible || !event) return null

  const finalized = event.payload.finalized
  const isWinner = Boolean(participantId && event.payload.winner_id === participantId)
  const accepting = isBuzzerAccepting(event)
  const presenterCanStart = Boolean(!participantId && onStart && !accepting && !finalized && !pressed && !busy)
  const canBuzz = Boolean(participantId && onBuzz && accepting && !pressed && !busy)

  async function start() {
    if (!presenterCanStart || !onStart) return
    setPressed(true)
    try {
      await onStart()
    } catch {
      setPressed(false)
    }
  }

  async function buzz() {
    if (!canBuzz || !onBuzz) return
    setPressed(true)
    try {
      await onBuzz()
    } catch {
      setPressed(false)
    }
  }

  return (
    <div className={`buzzer-overlay${finalized ? ' revealed' : ' active'}`} aria-live="assertive">
      <div className="buzzer-rings" />
      <div className="buzzer-content">
        {finalized ? (
          <>
            <PartyPopper size={participantId ? 54 : 68} />
            <p>{isWinner ? '???' : '????'}</p>
            <strong>{event.payload.winner_name}</strong>
          </>
        ) : (
          <>
            <p>{participantId ? (accepting ? '??????' : '????????') : (accepting ? '?????' : '??????')}</p>
            <button
              aria-label={participantId ? '??' : '????'}
              className={`buzzer-button${accepting ? '' : ' waiting'}`}
              disabled={participantId ? !canBuzz : !presenterCanStart}
              type="button"
              onClick={participantId ? buzz : start}
            >
              <Zap fill="currentColor" size={84} />
              <span>{pressed || busy ? '???' : participantId ? (accepting ? '??' : '???') : (accepting ? '???' : '????')}</span>
            </button>
            {!participantId && <small>{event.payload.candidate_count} ????</small>}
          </>
        )}
      </div>
      {finalized && Array.from({ length: 18 }, (_, index) => (
        <i className="celebration-piece" key={index} style={{ '--piece-index': index } as CSSProperties} />
      ))}
    </div>
  )
}
