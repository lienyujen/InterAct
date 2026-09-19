import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { densityBuckets } from '../lib/danmakuBursts'

type Props = {
  // Every message in the session, oldest first, as epoch milliseconds.
  times: number[]
  sessionStart: number
  sessionEnd: number
  selection: { from: number; to: number }
  onChange: (selection: { from: number; to: number }) => void
}

const BUCKETS = 90
// A minute is the narrowest window worth reading a cloud from, and it stops the
// two handles being dragged onto each other.
const MIN_SPAN_MS = 60_000

function clockLabel(time: number) {
  return new Date(time).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false })
}

// Drag either end to trim, or the middle to slide the whole window. The bars
// behind it are how many messages arrived when, so a presenter can see which
// part of the class was busiest and grab that stretch without remembering what
// time it was.
export function DanmakuTimeline({ times, sessionStart, sessionEnd, selection, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [dragging, setDragging] = useState<'from' | 'to' | 'range' | null>(null)
  const dragOrigin = useRef({ pointer: 0, from: 0, to: 0 })

  const span = Math.max(1, sessionEnd - sessionStart)
  const buckets = useMemo(
    () => densityBuckets(times, sessionStart, sessionEnd, BUCKETS),
    [times, sessionStart, sessionEnd],
  )
  const busiest = Math.max(1, ...buckets)

  const ratio = useCallback((time: number) => ((time - sessionStart) / span) * 100, [sessionStart, span])

  const timeAt = useCallback((clientX: number) => {
    const track = trackRef.current
    if (!track) return sessionStart
    const box = track.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)))
    return sessionStart + fraction * span
  }, [sessionStart, span])

  useEffect(() => {
    if (!dragging) return
    const move = (event: PointerEvent) => {
      const time = timeAt(event.clientX)
      if (dragging === 'from') {
        onChange({ from: Math.min(time, selection.to - MIN_SPAN_MS), to: selection.to })
        return
      }
      if (dragging === 'to') {
        onChange({ from: selection.from, to: Math.max(time, selection.from + MIN_SPAN_MS) })
        return
      }
      // Sliding the window keeps its width, and stops at the ends rather than
      // shrinking against them.
      const width = dragOrigin.current.to - dragOrigin.current.from
      const shift = time - dragOrigin.current.pointer
      const from = Math.min(Math.max(sessionStart, dragOrigin.current.from + shift), sessionEnd - width)
      onChange({ from, to: from + width })
    }
    const stop = () => setDragging(null)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [dragging, onChange, selection.from, selection.to, sessionEnd, sessionStart, timeAt])

  function begin(handle: 'from' | 'to' | 'range', event: React.PointerEvent) {
    event.preventDefault()
    dragOrigin.current = { pointer: timeAt(event.clientX), from: selection.from, to: selection.to }
    setDragging(handle)
  }

  const left = Math.max(0, Math.min(100, ratio(selection.from)))
  const right = Math.max(0, Math.min(100, ratio(selection.to)))

  return (
    <div className={`danmaku-timeline${dragging ? ' is-dragging' : ''}`}>
      <div className="danmaku-timeline-track" ref={trackRef}>
        <div className="danmaku-timeline-bars" aria-hidden="true">
          {buckets.map((count, index) => (
            <span key={index} style={{ height: `${Math.max(count ? 8 : 2, (count / busiest) * 100)}%` }} />
          ))}
        </div>
        <div className="danmaku-timeline-shade" style={{ left: 0, width: `${left}%` }} />
        <div className="danmaku-timeline-shade" style={{ left: `${right}%`, right: 0 }} />
        <div
          className="danmaku-timeline-window"
          style={{ left: `${left}%`, width: `${Math.max(0, right - left)}%` }}
          onPointerDown={(event) => begin('range', event)}
        />
        <button
          aria-label="調整起點"
          className="danmaku-timeline-handle"
          style={{ left: `${left}%` }}
          type="button"
          onPointerDown={(event) => begin('from', event)}
        />
        <button
          aria-label="調整終點"
          className="danmaku-timeline-handle"
          style={{ left: `${right}%` }}
          type="button"
          onPointerDown={(event) => begin('to', event)}
        />
      </div>
      <div className="danmaku-timeline-scale">
        <span>{clockLabel(sessionStart)}</span>
        <strong>{clockLabel(selection.from)} – {clockLabel(selection.to)}</strong>
        <span>{clockLabel(sessionEnd)}</span>
      </div>
    </div>
  )
}
