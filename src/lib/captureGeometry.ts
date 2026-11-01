export type CaptureBounds = { x: number; y: number; width: number; height: number }

// Pointer coordinates are CSS pixels in the actual content window. macOS may
// keep that window below the menu bar or inside the work area; it is not the
// entire display. Convert through desktop DIPs before mapping to image pixels.
export function captureCrop(rect: CaptureBounds, viewport: { width: number; height: number },
  content: CaptureBounds, display: CaptureBounds, image: { width: number; height: number }): CaptureBounds {
  if (![viewport.width, viewport.height, content.width, content.height, display.width, display.height, image.width, image.height]
    .every(value => Number.isFinite(value) && value > 0)
    || ![rect.x, rect.y, rect.width, rect.height, content.x, content.y, display.x, display.y].every(Number.isFinite)
    || rect.width <= 0 || rect.height <= 0) throw new Error('Invalid screen capture geometry')
  const point = (x: number, y: number) => ({
    x: Math.max(0, Math.min(image.width, Math.round((content.x - display.x + x * content.width / viewport.width) * image.width / display.width))),
    y: Math.max(0, Math.min(image.height, Math.round((content.y - display.y + y * content.height / viewport.height) * image.height / display.height))),
  })
  const start = point(rect.x, rect.y), end = point(rect.x + rect.width, rect.y + rect.height)
  if (end.x <= start.x || end.y <= start.y) throw new Error('Screen selection is outside the captured display')
  return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y }
}
