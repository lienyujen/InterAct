// Where one wave of replies ends and the next begins.
//
// The teacher asks something out loud and the class answers in the chat. There
// is no dispatch to anchor to — the question was spoken — so the anchor has to
// come from the replies themselves. It does, clearly: across five real classes
// the gap between messages inside a wave runs 1.4 to 4.7 seconds, while each
// session carries five to thirteen silences over ninety seconds. A minute of
// quiet is twenty times the normal spacing, which makes it an unambiguous
// boundary rather than a threshold anyone had to tune.

const QUIET_MS = 60_000

export type Burst = { start: number; end: number; count: number }

// Oldest first. Each burst spans the first and last message in it.
export function findBursts(times: number[]): Burst[] {
  const sorted = [...times].sort((left, right) => left - right)
  const bursts: Burst[] = []
  for (const time of sorted) {
    const current = bursts.at(-1)
    if (current && time - current.end <= QUIET_MS) {
      current.end = time
      current.count += 1
    } else {
      bursts.push({ start: time, end: time, count: 1 })
    }
  }
  return bursts
}

// The wave the presenter means when they open this window: the one that just
// happened. A trailing 謝謝老師 arriving a minute after everyone else is its own
// burst by the rule above and would leave the cloud showing a single word, so a
// burst too small to be an answer reaches back to take in the one before it.
const MIN_MEANINGFUL = 5

export function currentBurst(times: number[]): Burst | null {
  const bursts = findBursts(times)
  if (!bursts.length) return null
  const last = bursts.at(-1) as Burst
  const previous = bursts.at(-2)
  if (last.count >= MIN_MEANINGFUL || !previous) return last
  return { start: previous.start, end: last.end, count: previous.count + last.count }
}

// Bars for the timeline. Counting into fixed buckets rather than drawing one
// mark per message keeps the shape readable whether the class sent thirty
// messages or three hundred.
export function densityBuckets(times: number[], from: number, to: number, buckets: number) {
  const counts = new Array(buckets).fill(0)
  const span = Math.max(1, to - from)
  for (const time of times) {
    if (time < from || time > to) continue
    const index = Math.min(buckets - 1, Math.floor(((time - from) / span) * buckets))
    counts[index] += 1
  }
  return counts
}
