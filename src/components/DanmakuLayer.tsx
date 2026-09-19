import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Message, Session } from '../types'

type Props = {
  messages: Message[]
  session: Session
}

const LANES = 8

// Every message travels at the same speed. This is the part that matters: the
// lane used to be a hash of the message id and the duration varied with the
// length of the text, so two messages could land on the same lane and a short
// one launched later could catch a long one already crossing it. Equal speed
// makes overtaking impossible, which leaves only one thing to schedule — when a
// lane is next free.
const SPEED_PX_PER_SECOND = 150

// Clear air behind a message before its lane is offered again.
const GAP_PX = 140

// There is deliberately no cap on how long a message may wait. An earlier
// version released one that had queued too long onto the least-busy lane
// anyway, on the grounds that a late reply is worthless — but a message printed
// on top of another is not late, it is unreadable, and it takes its neighbour
// down with it. Queued at a steady pace the wait is 3 seconds even when the
// class is sending one message every 300ms; only forty arriving in the same
// instant pushes it past ten, and then waiting is still the better answer.

// Close enough for spacing: full-width characters take about an em, the rest
// about half. The gap above absorbs what this gets wrong.
function estimatedWidth(text: string) {
  let width = 34
  for (const character of text) {
    const code = character.codePointAt(0) || 0
    width += code > 0x2e80 ? 25 : 13
  }
  return width
}

type Placement = { lane: number; duration: number; delay: number }

export function DanmakuLayer({ messages, session }: Props) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [layerWidth, setLayerWidth] = useState(0)
  // Placements survive re-renders: a message that has started crossing must not
  // be handed a different lane because something else arrived.
  const placements = useRef(new Map<string, Placement>())
  const laneFreeAt = useRef<number[]>(Array.from({ length: LANES }, () => 0))
  const [, redraw] = useReducer((count: number) => count + 1, 0)

  // Memoised on the list itself, so the scheduling effect below can depend on it
  // directly rather than on a stringified stand-in.
  const visible = useMemo(() => messages.slice(-24), [messages])
  const anonymous = session.anonymous_enabled

  useEffect(() => {
    const element = layerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setLayerWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!layerWidth) return
    const now = performance.now()
    let placed = false

    for (const message of visible) {
      if (placements.current.has(message.id)) continue
      const width = estimatedWidth(displayText(message, anonymous))
      // The lane clear the longest, so messages spread across the screen instead
      // of stacking onto whichever lane happens to be first.
      let lane = 0
      for (let candidate = 1; candidate < LANES; candidate += 1) {
        if (laneFreeAt.current[candidate] < laneFreeAt.current[lane]) lane = candidate
      }
      const start = Math.max(now, laneFreeAt.current[lane])
      placements.current.set(message.id, {
        lane,
        duration: (layerWidth + width) / SPEED_PX_PER_SECOND,
        delay: (start - now) / 1000,
      })
      // Free again once this message's tail, plus a gap, has cleared the edge it
      // entered from.
      laneFreeAt.current[lane] = start + ((width + GAP_PX) / SPEED_PX_PER_SECOND) * 1000
      placed = true
    }

    // Forget anything that has dropped off the end of the list, so the map does
    // not grow for the length of the class.
    if (placements.current.size > visible.length) {
      const live = new Set(visible.map((message) => message.id))
      for (const id of [...placements.current.keys()]) {
        if (!live.has(id)) placements.current.delete(id)
      }
    }

    if (placed) redraw()
  }, [visible, layerWidth, anonymous])

  if (!session.danmaku_enabled) return null

  return (
    <div className="danmaku-layer" aria-live="polite" ref={layerRef}>
      {visible.map((message) => {
        const placement = placements.current.get(message.id)
        // Not scheduled yet — the effect runs on the next tick and brings it in.
        if (!placement) return null
        return (
          <div
            className="danmaku-item"
            key={message.id}
            style={{
              top: `${8 + placement.lane * 10}%`,
              animationDuration: `${placement.duration}s`,
              animationDelay: `${placement.delay}s`,
            }}
          >
            {displayText(message, anonymous)}
          </div>
        )
      })}
    </div>
  )
}

function displayText(message: Message, anonymous: boolean) {
  return anonymous ? message.content : `${message.participant_name}: ${message.content}`
}
