import { PartyPopper } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { LotterySessionEvent } from '../types'

type Props = {
  event: LotterySessionEvent | null
  participantId?: string | null
  onSelect?: (winnerId: string) => Promise<void> | void
}

export function LotteryOverlay({ event, participantId, onSelect }: Props) {
  const [displayedCandidate, setDisplayedCandidate] = useState({ id: '', name: '' })
  const [revealed, setRevealed] = useState(false)
  const [visible, setVisible] = useState(false)
  const [selectionPending, setSelectionPending] = useState(false)

  useEffect(() => {
    const finalized = event?.payload.finalized !== false
    if (!event || (participantId && (!finalized || event.payload.winner_id !== participantId))) {
      setVisible(false)
      return
    }

    const names = event.payload.candidate_names.length ? event.payload.candidate_names : [event.payload.winner_name]
    const ids = event.payload.candidate_ids?.length === names.length
      ? event.payload.candidate_ids
      : names.map(() => event.payload.winner_id)
    const candidates = names.map((name, index) => ({ id: ids[index], name }))
    setVisible(true)
    setSelectionPending(false)
    setRevealed(finalized)
    setDisplayedCandidate(finalized
      ? { id: event.payload.winner_id, name: event.payload.winner_name }
      : candidates[0])
    if (finalized) {
      const hideTimer = window.setTimeout(() => setVisible(false), 5200)
      return () => window.clearTimeout(hideTimer)
    }

    let index = 0
    const ticker = window.setInterval(() => {
      index = (index + 1) % candidates.length
      setDisplayedCandidate(candidates[index])
    }, 85)

    return () => window.clearInterval(ticker)
  }, [event, participantId])

  if (!visible || !event) return null

  const isWinnerDevice = Boolean(participantId)
  const interactive = Boolean(onSelect && !isWinnerDevice && !revealed)

  async function selectDisplayedCandidate() {
    if (!onSelect || selectionPending || !displayedCandidate.id) return
    setSelectionPending(true)
    try {
      await onSelect(displayedCandidate.id)
    } finally {
      setSelectionPending(false)
    }
  }

  return (
    <div className={`lottery-overlay${revealed ? ' revealed' : ''}${interactive ? ' interactive' : ''}`} aria-live="assertive">
      <div className="lottery-rays" />
      <div className="lottery-content">
        <PartyPopper size={isWinnerDevice ? 54 : 68} />
        <p>{revealed ? (isWinnerDevice ? '恭喜！' : '抽中的是') : '抽籤中'}</p>
        {interactive ? (
          <button
            className="lottery-name-button"
            disabled={selectionPending}
            title="點選目前姓名立即停止抽籤"
            type="button"
            onClick={selectDisplayedCandidate}
          >
            {displayedCandidate.name}
          </button>
        ) : (
          <strong>{isWinnerDevice && !revealed ? '請稍候...' : displayedCandidate.name}</strong>
        )}
        {!isWinnerDevice && <small>第 {event.payload.round} 輪．{event.payload.candidate_count} 人參與</small>}
      </div>
      {revealed && Array.from({ length: 18 }, (_, index) => (
        <i className="celebration-piece" key={index} style={{ '--piece-index': index } as CSSProperties} />
      ))}
    </div>
  )
}
