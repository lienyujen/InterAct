// The pin carries who put it there, so a presenter can see that the three
// students in the corner are the three who have not understood. Anonymous mode
// replaces it with a number, or the setting would not mean anything.
export function pinLabel(name: string, anonymous: boolean, index: number) {
  if (anonymous) return String(index + 1)
  const first = [...name.trim()][0]
  return first ? first.toUpperCase() : String(index + 1)
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
