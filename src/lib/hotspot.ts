// The pin carries who put it there, so a presenter can see that the three
// students in the corner are the three who have not understood. Anonymous mode
// replaces it with a number, or the setting would not mean anything.
export function pinLabel(name: string, anonymous: boolean, index: number) {
  if (anonymous) return String(index + 1)
  const first = [...name.trim()][0]
  return first ? first.toUpperCase() : String(index + 1)
}

// One colour per student, the same every time they mark anything, in this
// question and in every other. Before this every pin was the same translucent
// violet, so a busy picture turned into one indistinct bruise and the presenter
// could no longer tell eighteen students agreeing from one student hedging.
//
// All fourteen are dark enough to carry white text and far enough apart in hue
// to be told apart on a photograph. Derived from the id rather than stored, so
// nothing has to remember it.
const PIN_COLORS = [
  '#e53935', '#d81b60', '#8e24aa', '#5e35b1', '#3949ab', '#1e88e5', '#0288d1',
  '#00897b', '#2e7d32', '#558b2f', '#ef6c00', '#d84315', '#6d4c41', '#455a64',
]

// The enlarged window reads its answers back through the edge function, and an
// app running against a function that predates this change is handed no id at
// all. A missing id falls back to the old single violet instead of throwing, so
// the marks stay on the picture until that function is redeployed.
export function pinColor(participantId: string | null | undefined) {
  if (!participantId) return ''
  let hash = 2166136261
  for (let index = 0; index < participantId.length; index += 1) {
    hash ^= participantId.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return PIN_COLORS[(hash >>> 0) % PIN_COLORS.length]
}

export function parsePins(values: string[] | null | undefined) {
  return (values || []).flatMap((value) => {
    const [x, y] = value.split(',').map(Number)
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : []
  })
}

export function serialisePins(points: Array<{ x: number; y: number }>) {
  return points.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`)
}
