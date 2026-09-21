import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Message, Session } from '../types'

type Props = {
  messages: Message[]
  session: Session
}

const LANES = 8

// Speed varies with how much there is to read. Two characters go past at full
// tilt; a whole sentence crosses at 0.8x, which is both livelier to watch and
// fairer to the reader, since the long one is the one that needs the time.
//
// Everything travelled at one speed before, and that was not an aesthetic
// choice: equal speed makes overtaking impossible, so a lane only had to be
// scheduled for when it was next free. Varying the speed gives that back, and
// the two constraints in earliestStart below are what replace it.
const SPEED_FAST_PX_PER_SECOND = 150
const SPEED_SLOW_PX_PER_SECOND = 120

// Where the two ends of that range sit. Below four characters — 好, 懂了, 可以 —
// nothing is gained by slowing down; past a couple of dozen the message is a
// sentence and wants the extra second.
const SHORT_CHARS = 4
const LONG_CHARS = 24

function speedFor(content: string) {
  // Code points, not UTF-16 units, so an emoji counts as the one character it
  // looks like rather than two.
  const chars = [...content].length
  const along = Math.min(1, Math.max(0, (chars - SHORT_CHARS) / (LONG_CHARS - SHORT_CHARS)))
  return SPEED_FAST_PX_PER_SECOND + (SPEED_SLOW_PX_PER_SECOND - SPEED_FAST_PX_PER_SECOND) * along
}

// Clear air behind a message before its lane is offered again.
const GAP_PX = 140

// Slack in the no-catching-up rule below. Without it the two may close to
// exactly nothing at the left edge, which is the correct answer for the widths
// this file computes — but those widths are estimates, so anything the estimate
// gets wrong comes straight off a margin of zero. Two characters' worth buys
// about a quarter of a second per lane.
const CATCH_UP_MARGIN_PX = 48

// There is deliberately no cap on how long a message may wait. An earlier
// version released one that had queued too long onto the least-busy lane
// anyway, on the grounds that a late reply is worthless — but a message printed
// on top of another is not late, it is unreadable, and it takes its neighbour
// down with it. Queued at a steady pace the wait is 3 seconds even when the
// class is sending one message every 300ms; only forty arriving in the same
// instant pushes it past ten, and then waiting is still the better answer.

// A fallback only, for the first frame before the measuring node exists. Every
// version of this that tried to be a character table was wrong somewhere: half
// an em per latin character was 72px short on a line of capitals, and fixing
// capitals left W, M and digits short by up to 95px — more than the margin the
// scheduler works with. Guessing high is the safe direction, so this one is
// deliberately generous.
function estimatedWidth(text: string) {
  let width = 34
  for (const character of text) {
    const code = character.codePointAt(0) || 0
    width += code > 0x2e80 ? 30 : 18
  }
  return width
}

type Placement = { lane: number; duration: number; delay: number }

// What is already in a lane: when it entered, how wide it is, how fast it goes.
// A single time was enough while everything moved at one speed; now the message
// behind has to know what it is following.
type LaneTail = { start: number; width: number; speed: number }

// The earliest a message travelling at this speed may enter that lane without
// ever touching what is already in it. Two separate things have to hold, and the
// answer is whichever is later.
//
// How wide the arriving message is does not come into it. It enters behind the
// one already crossing, so the only edges that can ever meet are its leading
// edge and that one's tail; its own length matters to whatever comes after it,
// which is why the lane remembers it below.
function earliestStart(tail: LaneTail | null, speed: number, layerWidth: number) {
  if (!tail) return 0

  // 1. Clear air at the entry edge. The tail of the message in front, plus a
  //    gap, must be past the right edge before anything is put there. This is
  //    the one that stops two messages being printed on top of each other at the
  //    instant they launch — the failure that actually happened, and the reason
  //    this constraint is the strict one.
  const entryClear = tail.start + ((tail.width + GAP_PX) / tail.speed) * 1000

  // 2. No catching up. If this message is the faster of the two it closes on the
  //    one in front, and the gap between them is narrowest at the moment that
  //    one leaves the screen. Requiring this one's leading edge not to have
  //    reached the far edge by then is exactly enough — the two can meet, but
  //    only at the edge, where both are already out of sight. It is cheap:
  //    roughly a second per lane at the widest speed difference, and nothing at
  //    all when the message behind is the slower one.
  const noCatchUp = tail.start
    + ((layerWidth + tail.width) / tail.speed - (layerWidth - CATCH_UP_MARGIN_PX) / speed) * 1000

  return Math.max(entryClear, noCatchUp)
}

export function DanmakuLayer({ messages, session }: Props) {
  const layerRef = useRef<HTMLDivElement | null>(null)
  // A hidden copy of a danmaku item, kept in the layer so it inherits exactly
  // the same font and padding. The scheduler needs to know how wide a message
  // will be before it is drawn, and asking the browser is both exact and
  // cheaper to maintain than a table of character widths.
  const measureRef = useRef<HTMLDivElement | null>(null)
  const [layerWidth, setLayerWidth] = useState(0)
  // Placements survive re-renders: a message that has started crossing must not
  // be handed a different lane because something else arrived.
  const placements = useRef(new Map<string, Placement>())
  const lanes = useRef<Array<LaneTail | null>>(Array.from({ length: LANES }, () => null))
  const [, redraw] = useReducer((count: number) => count + 1, 0)

  const enabled = session.danmaku_enabled
  const anonymous = session.anonymous_enabled

  // Switching the danmaku off only stopped it being drawn. The overlay keeps
  // collecting messages either way, and the placements here are a delay
  // measured from the moment each one was scheduled — so switching back on
  // rebuilt the same elements and every animation started again from its own
  // beginning. The class watched the last two dozen messages fly past a second
  // time.
  //
  // So switching on draws a line: everything already collected belongs to the
  // run that was switched off. The line is the newest message's own timestamp
  // rather than the clock here, because the two clocks are not the same one.
  //
  // Drawn during the render that sees the switch, not in an effect. An effect
  // runs after the scheduling one below has already been handed the old line —
  // which means the whole backlog gets placed, and although those placements
  // are then cleaned up, the lane tails they left behind are not. Every
  // message after that queued behind a crowd that was never drawn: the first
  // one measured a four second delay after a backlog of 24, and a real class
  // backlog is far longer than that. It looked like the danmaku had stopped.
  const [lastEnabled, setLastEnabled] = useState(enabled)
  const [liveSince, setLiveSince] = useState('')
  if (enabled !== lastEnabled) {
    setLastEnabled(enabled)
    if (enabled) {
      setLiveSince(messages.length ? messages[messages.length - 1].created_at : '')
      placements.current.clear()
      lanes.current = Array.from({ length: LANES }, () => null)
    }
  }

  // Memoised on the list itself, so the scheduling effect below can depend on it
  // directly rather than on a stringified stand-in.
  const visible = useMemo(
    () => messages.filter((message) => message.created_at > liveSince).slice(-24),
    [liveSince, messages],
  )

  useEffect(() => {
    const element = layerRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setLayerWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!enabled || !layerWidth) return
    const now = performance.now()
    let placed = false

    for (const message of visible) {
      if (placements.current.has(message.id)) continue
      const width = measuredWidth(measureRef.current, displayText(message, anonymous))
      // The name in front of the message is not what makes a message long to
      // read, so speed comes from what the student wrote and the width from what
      // is actually drawn.
      const speed = speedFor(message.content)
      // The lane this one can enter soonest. Which lane that is now depends on
      // the message itself: a slow message can slip in behind a fast one that a
      // faster message would have had to queue for.
      let lane = 0
      let best = earliestStart(lanes.current[0], speed, layerWidth)
      for (let candidate = 1; candidate < LANES; candidate += 1) {
        const at = earliestStart(lanes.current[candidate], speed, layerWidth)
        if (at < best) {
          lane = candidate
          best = at
        }
      }
      const start = Math.max(now, best)
      placements.current.set(message.id, {
        lane,
        duration: (layerWidth + width) / speed,
        delay: (start - now) / 1000,
      })
      lanes.current[lane] = { start, width, speed }
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
  }, [visible, layerWidth, anonymous, enabled])

  // The layer itself stays mounted whether or not the danmaku is on, and only
  // its contents come and go.
  //
  // Returning null here took the element out of the page, and a ResizeObserver
  // reports 0x0 when the element it is watching is detached — so the measured
  // width went to zero, and since the observer was still watching that dead
  // node it never came back. Switching on gave the scheduler a width of zero,
  // which it reads as "not measured yet" and returns; nothing was ever placed
  // again for the rest of the class. It is empty and pointer-events: none, so
  // leaving it there costs nothing.
  return (
    <div className="danmaku-layer" aria-live="polite" ref={layerRef}>
      <div aria-hidden="true" className="danmaku-item danmaku-measure" ref={measureRef} />
      {enabled && visible.map((message) => {
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

function measuredWidth(node: HTMLDivElement | null, text: string) {
  if (!node) return estimatedWidth(text)
  node.textContent = text
  return node.getBoundingClientRect().width
}

function displayText(message: Message, anonymous: boolean) {
  return anonymous ? message.content : `${message.participant_name}: ${message.content}`
}
