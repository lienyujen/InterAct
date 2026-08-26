function visualUnits(character: string) {
  if (/\s/u.test(character)) return 0.32
  if ((character.codePointAt(0) || 0) <= 0x024f) return 0.56
  return 1
}

export function latestCaptionLines(text: string, fontSize: number, viewportWidth = window.innerWidth, maxLines = 2) {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  if (!normalized) return ''
  const maximumWidth = viewportWidth >= 1200 ? 1400 : 920
  const availableWidth = Math.max(240, Math.min(maximumWidth, viewportWidth - (viewportWidth >= 800 ? 96 : 36)))
  const unitLimit = Math.max(12, (availableWidth / Math.max(18, fontSize)) * maxLines)
  const characters = Array.from(normalized)
  let units = 0
  let start = characters.length
  while (start > 0) {
    const next = visualUnits(characters[start - 1])
    if (units + next > unitLimit) break
    units += next
    start -= 1
  }
  const suffix = characters.slice(start).join('').replace(/^[\s，。！？、；：,.!?;:]+/u, '')
  return start > 0 ? `…${suffix}` : suffix
}
