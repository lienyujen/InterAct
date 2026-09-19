// The geometry behind selecting, moving, turning and resizing something on
// the drawing board. Its own module so it can be tested directly, and because
// exporting it from the component file broke Fast Refresh.

export type Point = { x: number; y: number }
export type Box = { left: number; top: number; right: number; bottom: number }

// Where a mark has been moved, turned and resized to since it was drawn. Kept
// beside the mark rather than baked into its points, so the original stroke is
// never degraded by being transformed over and over.
export type Transform = { x: number; y: number; scale: number; angle: number }

export const IDENTITY: Transform = { x: 0, y: 0, scale: 1, angle: 0 }

export function centerOf(box: Box): Point {
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }
}

// The four corners after the mark has been moved, turned and resized.
export function corners(box: Box, transform: Transform): Point[] {
  const middle = centerOf(box)
  const cos = Math.cos(transform.angle)
  const sin = Math.sin(transform.angle)
  return [
    { x: box.left, y: box.top }, { x: box.right, y: box.top },
    { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom },
  ].map((corner) => {
    const dx = (corner.x - middle.x) * transform.scale
    const dy = (corner.y - middle.y) * transform.scale
    return {
      x: middle.x + transform.x + dx * cos - dy * sin,
      y: middle.y + transform.y + dx * sin + dy * cos,
    }
  })
}

// Undo the transform so a hit test can be done against the plain box.
export function toLocal(point: Point, box: Box, transform: Transform): Point {
  const middle = centerOf(box)
  const dx = point.x - (middle.x + transform.x)
  const dy = point.y - (middle.y + transform.y)
  const cos = Math.cos(-transform.angle)
  const sin = Math.sin(-transform.angle)
  return {
    x: middle.x + (dx * cos - dy * sin) / transform.scale,
    y: middle.y + (dx * sin + dy * cos) / transform.scale,
  }
}

export function isInside(point: Point, box: Box, transform: Transform) {
  const local = toLocal(point, box, transform)
  return local.x >= box.left && local.x <= box.right && local.y >= box.top && local.y <= box.bottom
}
