import { Check, Eraser, MousePointer2, Pen, RotateCcw, Trash2, Type as TypeIcon, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'

type Props = {
  busy: boolean
  locale: ParticipantLocale
  // The capture the presenter sent, if they sent one. It starts underneath the
  // drawing, and the student can take it away and start on white paper.
  backgroundUrl: string | null
  onSubmit: (file: File) => Promise<void>
}

// Written on a plain canvas rather than with a drawing library, for three
// reasons that all came out the same way:
//
// tldraw is the best of them and its licence asks for a paid one to remove the
// watermark from a commercial product, which is exactly what InterAct sells.
// Excalidraw is MIT but about a megabyte and a half before it draws anything,
// and this page is opened on phones on school wifi. Fabric brings three
// hundred kilobytes for a feature set that is mostly not wanted here.
//
// What is actually needed is a pen, an eraser, text, undo, a picture
// underneath, and the pinch-to-move-and-turn that anyone who owns a phone
// already knows — and Pointer Events give mouse, finger and stylus in one code
// path, including the presenter's touch display.

type Point = { x: number; y: number }
// Where a mark has been moved, turned and resized to since it was drawn. Kept
// beside the mark rather than baked into its points, so the original stroke is
// never degraded by being transformed over and over.
type Transform = { x: number; y: number; scale: number; angle: number }
type Stroke = { id: number; tool: 'pen' | 'eraser'; color: string; width: number; points: Point[]; transform: Transform }
type Label = { id: number; tool: 'text'; color: string; size: number; at: Point; text: string; transform: Transform }
type Mark = Stroke | Label
type Box = { left: number; top: number; right: number; bottom: number }

const COLORS = ['#18223a', '#d4584e', '#1463ff', '#288a62', '#c78b20']
const WIDTHS = [3, 7, 16]
// Big enough that a finger-drawn line is not a staircase, small enough that a
// class of thirty is not uploading megabytes each.
const CANVAS = { width: 1280, height: 960 }
const IDENTITY: Transform = { x: 0, y: 0, scale: 1, angle: 0 }
// The corner grip, in canvas units. Generous, because it is aimed at with a
// fingertip on a phone.
const HANDLE = 34

function centerOf(box: Box): Point {
  return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }
}

// Where a mark sits before it was moved or turned.
export function baseBox(mark: Mark, measure: CanvasRenderingContext2D): Box {
  if (mark.tool === 'text') {
    measure.font = `600 ${mark.size}px system-ui, "Noto Sans TC", sans-serif`
    const lines = mark.text.split('\n')
    const width = Math.max(...lines.map((line) => measure.measureText(line).width))
    return {
      left: mark.at.x,
      top: mark.at.y,
      right: mark.at.x + width,
      bottom: mark.at.y + lines.length * mark.size * 1.3,
    }
  }
  const xs = mark.points.map((point) => point.x)
  const ys = mark.points.map((point) => point.y)
  const pad = mark.width / 2 + 4
  return {
    left: Math.min(...xs) - pad,
    top: Math.min(...ys) - pad,
    right: Math.max(...xs) + pad,
    bottom: Math.max(...ys) + pad,
  }
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

// Undo the transform so the hit test can be done against the plain box.
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

export function BoardDrawing({ busy, locale, backgroundUrl, onSubmit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // The student's marks live on their own canvas so the eraser can take them
  // off without touching the picture underneath. Compositing the two is what
  // makes "remove the teacher's image" a toggle rather than a redraw.
  const inkRef = useRef<HTMLCanvasElement | null>(null)
  const backgroundRef = useRef<HTMLImageElement | null>(null)
  const marksRef = useRef<Mark[]>([])
  const drawingRef = useRef<Stroke | null>(null)
  const selectedRef = useRef<number | null>(null)
  const nextId = useRef(1)
  // Live pointers, so two fingers can be told from one.
  const pointersRef = useRef(new Map<number, Point>())
  // What the selected mark looked like when the current gesture started, and
  // the geometry of the fingers at that moment. Everything is computed from
  // the start rather than accumulated frame by frame, so a gesture cannot
  // drift.
  const gestureRef = useRef<
    | null
    | { kind: 'move' | 'pinch' | 'handle'; from: Transform; a: Point; b?: Point; center: Point }
  >(null)

  const [tool, setTool] = useState<'select' | 'pen' | 'eraser' | 'text'>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(WIDTHS[1])
  const [keepBackground, setKeepBackground] = useState(true)
  const [typing, setTyping] = useState<{ at: Point; value: string } | null>(null)
  const [, redraw] = useState(0)
  const bump = () => redraw((count) => count + 1)

  // Everything is kept as marks and replayed, so undo is a pop, the background
  // toggle is free, and a transform is a property rather than a redraw.
  // Snapshots would have been simpler and cost five megabytes a step.
  const render = useCallback((withSelection = true) => {
    const canvas = canvasRef.current
    const ink = inkRef.current
    if (!canvas || !ink) return
    const inkContext = ink.getContext('2d')
    const context = canvas.getContext('2d')
    if (!inkContext || !context) return

    inkContext.clearRect(0, 0, CANVAS.width, CANVAS.height)
    inkContext.lineCap = 'round'
    inkContext.lineJoin = 'round'
    const all = drawingRef.current ? [...marksRef.current, drawingRef.current] : marksRef.current
    for (const mark of all) {
      const box = baseBox(mark, inkContext)
      const middle = centerOf(box)
      inkContext.save()
      inkContext.translate(middle.x + mark.transform.x, middle.y + mark.transform.y)
      inkContext.rotate(mark.transform.angle)
      inkContext.scale(mark.transform.scale, mark.transform.scale)
      inkContext.translate(-middle.x, -middle.y)

      if (mark.tool === 'text') {
        inkContext.globalCompositeOperation = 'source-over'
        inkContext.fillStyle = mark.color
        inkContext.font = `600 ${mark.size}px system-ui, "Noto Sans TC", sans-serif`
        inkContext.textBaseline = 'top'
        mark.text.split('\n').forEach((line, index) => {
          inkContext.fillText(line, mark.at.x, mark.at.y + index * mark.size * 1.3)
        })
        inkContext.restore()
        continue
      }
      // The eraser cuts a hole in the student's own layer, so it removes marks
      // without punching through to the picture behind them.
      inkContext.globalCompositeOperation = mark.tool === 'eraser' ? 'destination-out' : 'source-over'
      inkContext.strokeStyle = mark.color
      inkContext.lineWidth = mark.width
      inkContext.beginPath()
      const [first, ...rest] = mark.points
      if (first && !rest.length) {
        // A tap with no movement is still a dot, which is what a student
        // expects when they put the pen down and lift it again.
        inkContext.arc(first.x, first.y, mark.width / 2, 0, Math.PI * 2)
        inkContext.fillStyle = mark.color
        inkContext.fill()
      } else if (first) {
        inkContext.moveTo(first.x, first.y)
        for (const point of rest) inkContext.lineTo(point.x, point.y)
        inkContext.stroke()
      }
      inkContext.restore()
    }
    inkContext.globalCompositeOperation = 'source-over'

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, CANVAS.width, CANVAS.height)
    const image = backgroundRef.current
    if (keepBackground && image) {
      // Fitted rather than stretched: a squashed screenshot is not the thing
      // the presenter asked the class to look at.
      const scale = Math.min(CANVAS.width / image.naturalWidth, CANVAS.height / image.naturalHeight)
      const drawWidth = image.naturalWidth * scale
      const drawHeight = image.naturalHeight * scale
      context.drawImage(image, (CANVAS.width - drawWidth) / 2, (CANVAS.height - drawHeight) / 2, drawWidth, drawHeight)
    }
    context.drawImage(ink, 0, 0)

    // The selection frame is drawn on the visible canvas only, never into the
    // ink layer — otherwise it would be exported along with the drawing.
    const selected = withSelection ? marksRef.current.find((mark) => mark.id === selectedRef.current) : undefined
    if (selected) {
      const shape = corners(baseBox(selected, inkContext), selected.transform)
      context.save()
      context.strokeStyle = '#5b5ce2'
      context.lineWidth = 3
      context.setLineDash([10, 8])
      context.beginPath()
      shape.forEach((corner, index) => (index ? context.lineTo(corner.x, corner.y) : context.moveTo(corner.x, corner.y)))
      context.closePath()
      context.stroke()
      context.setLineDash([])
      // One grip, on the corner furthest from the start, for turning and
      // resizing with a mouse. Two fingers do the same thing without it.
      const grip = shape[2]
      context.fillStyle = '#5b5ce2'
      context.beginPath()
      context.arc(grip.x, grip.y, HANDLE / 2, 0, Math.PI * 2)
      context.fill()
      context.restore()
    }
  }, [keepBackground])

  useEffect(() => {
    if (!inkRef.current) {
      const ink = document.createElement('canvas')
      ink.width = CANVAS.width
      ink.height = CANVAS.height
      inkRef.current = ink
    }
    render()
  }, [render])

  useEffect(() => {
    if (!backgroundUrl) {
      backgroundRef.current = null
      render()
      return
    }
    const image = new Image()
    // The capture is served from Supabase storage, so the canvas would be
    // tainted and toBlob would throw without this.
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      backgroundRef.current = image
      render()
    }
    image.src = backgroundUrl
  }, [backgroundUrl, render])

  function pointFrom(event: { clientX: number; clientY: number }, canvas: HTMLCanvasElement): Point {
    const box = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - box.left) / box.width) * CANVAS.width,
      y: ((event.clientY - box.top) / box.height) * CANVAS.height,
    }
  }

  function markAt(at: Point): Mark | undefined {
    const context = inkRef.current?.getContext('2d')
    if (!context) return undefined
    // Topmost first, so the thing drawn last is the thing picked up.
    for (let index = marksRef.current.length - 1; index >= 0; index -= 1) {
      const mark = marksRef.current[index]
      const box = baseBox(mark, context)
      const local = toLocal(at, box, mark.transform)
      if (local.x >= box.left && local.x <= box.right && local.y >= box.top && local.y <= box.bottom) return mark
    }
    return undefined
  }

  function selectedMark() {
    return marksRef.current.find((mark) => mark.id === selectedRef.current)
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (busy) return
    const canvas = event.currentTarget
    const at = pointFrom(event, canvas)
    pointersRef.current.set(event.pointerId, at)
    try {
      canvas.setPointerCapture(event.pointerId)
    } catch {
      // Drawing works without it.
    }

    if (tool === 'text') {
      // Committing first means a second tap places a second label rather than
      // throwing the first one away.
      if (typing) commitText()
      setTyping({ at, value: '' })
      return
    }

    if (tool === 'select') {
      const current = selectedMark()
      const context = inkRef.current?.getContext('2d')
      if (current && context && pointersRef.current.size === 1) {
        const grip = corners(baseBox(current, context), current.transform)[2]
        if (Math.hypot(at.x - grip.x, at.y - grip.y) <= HANDLE) {
          const box = baseBox(current, context)
          const middle = centerOf(box)
          gestureRef.current = {
            kind: 'handle',
            from: { ...current.transform },
            a: at,
            center: { x: middle.x + current.transform.x, y: middle.y + current.transform.y },
          }
          return
        }
      }
      if (pointersRef.current.size === 1) {
        const hit = markAt(at)
        selectedRef.current = hit ? hit.id : null
        gestureRef.current = hit
          ? { kind: 'move', from: { ...hit.transform }, a: at, center: { x: 0, y: 0 } }
          : null
        render()
        bump()
        return
      }
      // A second finger turns a drag into a pinch, from wherever things are now.
      const mark = selectedMark()
      if (mark) {
        const [a, b] = [...pointersRef.current.values()]
        gestureRef.current = { kind: 'pinch', from: { ...mark.transform }, a, b, center: { x: 0, y: 0 } }
      }
      return
    }

    drawingRef.current = {
      id: nextId.current++,
      tool,
      color,
      width: tool === 'eraser' ? width * 3 : width,
      points: [at],
      transform: { ...IDENTITY },
    }
    render()
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, pointFrom(event, canvas))

    if (tool === 'select') {
      const mark = selectedMark()
      const gesture = gestureRef.current
      if (!mark || !gesture) return
      const points = [...pointersRef.current.values()]

      if (gesture.kind === 'handle') {
        // Distance from the centre scales; the angle around it turns.
        const startSpan = Math.hypot(gesture.a.x - gesture.center.x, gesture.a.y - gesture.center.y) || 1
        const now = points[0]
        const span = Math.hypot(now.x - gesture.center.x, now.y - gesture.center.y)
        const startAngle = Math.atan2(gesture.a.y - gesture.center.y, gesture.a.x - gesture.center.x)
        const angle = Math.atan2(now.y - gesture.center.y, now.x - gesture.center.x)
        mark.transform = {
          ...gesture.from,
          scale: Math.min(8, Math.max(0.15, gesture.from.scale * (span / startSpan))),
          angle: gesture.from.angle + (angle - startAngle),
        }
      } else if (gesture.kind === 'pinch' && gesture.b && points.length >= 2) {
        const [a, b] = points
        const startSpan = Math.hypot(gesture.a.x - gesture.b.x, gesture.a.y - gesture.b.y) || 1
        const span = Math.hypot(a.x - b.x, a.y - b.y)
        const startAngle = Math.atan2(gesture.b.y - gesture.a.y, gesture.b.x - gesture.a.x)
        const angle = Math.atan2(b.y - a.y, b.x - a.x)
        const startMid = { x: (gesture.a.x + gesture.b.x) / 2, y: (gesture.a.y + gesture.b.y) / 2 }
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        mark.transform = {
          x: gesture.from.x + (mid.x - startMid.x),
          y: gesture.from.y + (mid.y - startMid.y),
          scale: Math.min(8, Math.max(0.15, gesture.from.scale * (span / startSpan))),
          angle: gesture.from.angle + (angle - startAngle),
        }
      } else if (gesture.kind === 'move') {
        const now = points[0]
        mark.transform = {
          ...gesture.from,
          x: gesture.from.x + (now.x - gesture.a.x),
          y: gesture.from.y + (now.y - gesture.a.y),
        }
      }
      render()
      return
    }

    const stroke = drawingRef.current
    if (!stroke) return
    // Coalesced events are the difference between a smooth line and a polygon
    // when a finger moves faster than the frame rate — but they are an extra,
    // not a replacement. Some events report none, and using the list on its
    // own then threw every point of the stroke away and left a single dot.
    const coalesced = typeof event.nativeEvent.getCoalescedEvents === 'function'
      ? event.nativeEvent.getCoalescedEvents()
      : []
    const events = coalesced.length ? coalesced : [event.nativeEvent]
    for (const raw of events) stroke.points.push(pointFrom(raw, canvas))
    render()
  }

  function onPointerUp(event: React.PointerEvent<HTMLCanvasElement>) {
    pointersRef.current.delete(event.pointerId)
    if (tool === 'select') {
      // Lifting one of two fingers ends the pinch rather than turning it into
      // a lurching one-finger drag from the wrong starting point.
      if (pointersRef.current.size === 0) gestureRef.current = null
      else if (gestureRef.current?.kind === 'pinch') gestureRef.current = null
      bump()
      return
    }
    const stroke = drawingRef.current
    if (!stroke) return
    drawingRef.current = null
    marksRef.current = [...marksRef.current, stroke]
    render()
    bump()
  }

  function commitText() {
    if (!typing) return
    const text = typing.value.trim()
    if (text) {
      marksRef.current = [...marksRef.current, {
        id: nextId.current++,
        tool: 'text',
        color,
        size: Math.max(20, width * 4),
        at: typing.at,
        text,
        transform: { ...IDENTITY },
      }]
    }
    setTyping(null)
    render()
    bump()
  }

  function undo() {
    const last = marksRef.current.at(-1)
    if (last && last.id === selectedRef.current) selectedRef.current = null
    marksRef.current = marksRef.current.slice(0, -1)
    render()
    bump()
  }

  function removeSelected() {
    marksRef.current = marksRef.current.filter((mark) => mark.id !== selectedRef.current)
    selectedRef.current = null
    render()
    bump()
  }

  function clearAll() {
    marksRef.current = []
    selectedRef.current = null
    render()
    bump()
  }

  async function send() {
    const canvas = canvasRef.current
    if (!canvas) return
    // Without this the dashed selection frame would be exported with the
    // drawing, which is the sort of thing nobody notices until it is on a wall
    // in front of a class.
    selectedRef.current = null
    render(false)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    await onSubmit(new File([blob], 'drawing.png', { type: 'image/png' }))
    clearAll()
  }

  const empty = marksRef.current.length === 0
  const hasSelection = selectedRef.current !== null

  return (
    <div className="board-composer-body board-drawing">
      <div className="board-drawing-tools">
        <div className="board-drawing-group">
          {([
            ['select', MousePointer2, 'drawSelect'],
            ['pen', Pen, 'drawPen'],
            ['eraser', Eraser, 'drawEraser'],
            ['text', TypeIcon, 'drawText'],
          ] as const).map(([name, Icon, key]) => (
            <button
              aria-pressed={tool === name}
              className={tool === name ? 'is-selected' : 'ghost-button'}
              key={name}
              type="button"
              onClick={() => {
                setTool(name)
                if (name !== 'select') {
                  selectedRef.current = null
                  render()
                }
                bump()
              }}
            >
              <Icon size={16} />{participantText(locale, key)}
            </button>
          ))}
        </div>

        <div className="board-drawing-group">
          {COLORS.map((swatch) => (
            <button
              aria-label={swatch}
              aria-pressed={color === swatch}
              className={`board-swatch${color === swatch ? ' is-selected' : ''}`}
              key={swatch}
              style={{ background: swatch }}
              type="button"
              onClick={() => setColor(swatch)}
            />
          ))}
        </div>

        <div className="board-drawing-group">
          {WIDTHS.map((size) => (
            <button
              aria-label={`${size}`}
              aria-pressed={width === size}
              className={`board-width${width === size ? ' is-selected' : ''}`}
              key={size}
              type="button"
              onClick={() => setWidth(size)}
            >
              <span style={{ height: size, width: size }} />
            </button>
          ))}
        </div>

        <div className="board-drawing-group">
          {hasSelection && (
            <button className="ghost-button" type="button" onClick={removeSelected}>
              <Trash2 size={16} />{participantText(locale, 'drawDeleteSelected')}
            </button>
          )}
          <button className="ghost-button" disabled={empty} type="button" onClick={undo}>
            <RotateCcw size={16} />{participantText(locale, 'drawUndo')}
          </button>
          <button className="ghost-button" disabled={empty} type="button" onClick={clearAll}>
            <Trash2 size={16} />{participantText(locale, 'drawClear')}
          </button>
        </div>
      </div>

      {tool === 'select' && (
        <p className="muted board-drawing-hint">{participantText(locale, 'drawSelectHint')}</p>
      )}

      {backgroundUrl && (
        <label className="multi-select-setting">
          <input
            checked={!keepBackground}
            type="checkbox"
            onChange={(event) => setKeepBackground(!event.target.checked)}
          />
          {participantText(locale, 'drawBlank')}
        </label>
      )}

      <div className="board-drawing-surface">
        <canvas
          height={CANVAS.height}
          ref={canvasRef}
          width={CANVAS.width}
          onPointerCancel={onPointerUp}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        {typing && (
          <div
            className="board-drawing-text-input"
            style={{ left: `${(typing.at.x / CANVAS.width) * 100}%`, top: `${(typing.at.y / CANVAS.height) * 100}%` }}
          >
            {/* No commit on blur. A mouse click puts the caret here and then
                takes the focus straight back, so blur fired with an empty
                value and the box vanished before anything could be typed —
                which is why this worked on a phone and not on a laptop. */}
            <input
              autoFocus
              placeholder={participantText(locale, 'drawTextPlaceholder')}
              value={typing.value}
              onChange={(event) => setTyping({ ...typing, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitText()
                if (event.key === 'Escape') setTyping(null)
              }}
            />
            <button aria-label="確定" type="button" onClick={commitText}><Check size={16} /></button>
            <button aria-label="取消" className="ghost-button" type="button" onClick={() => setTyping(null)}><X size={16} /></button>
          </div>
        )}
      </div>

      <button disabled={busy || empty} type="button" onClick={() => void send()}>
        {busy ? participantText(locale, 'boardUploading') : participantText(locale, 'boardPost')}
      </button>
    </div>
  )
}
