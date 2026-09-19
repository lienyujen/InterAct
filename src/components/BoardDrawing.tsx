import { Eraser, Pen, RotateCcw, Trash2, Type as TypeIcon } from 'lucide-react'
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
// What is actually needed is a pen, an eraser, text, undo, and a picture
// underneath — and Pointer Events give mouse, finger and stylus in one code
// path, including the presenter's touch display.

type Point = { x: number; y: number }
type Stroke = { tool: 'pen' | 'eraser'; color: string; width: number; points: Point[] }
type Label = { tool: 'text'; color: string; size: number; at: Point; text: string }
type Mark = Stroke | Label

const COLORS = ['#18223a', '#d4584e', '#1463ff', '#288a62', '#c78b20']
const WIDTHS = [3, 7, 16]
// Big enough that a finger-drawn line is not a staircase, small enough that a
// class of thirty is not uploading megabytes each.
const CANVAS = { width: 1280, height: 960 }

export function BoardDrawing({ busy, locale, backgroundUrl, onSubmit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // The student's marks live on their own canvas so the eraser can take them
  // off without touching the picture underneath. Compositing the two is what
  // makes "remove the teacher's image" a toggle rather than a redraw.
  const inkRef = useRef<HTMLCanvasElement | null>(null)
  const backgroundRef = useRef<HTMLImageElement | null>(null)
  const marksRef = useRef<Mark[]>([])
  const drawingRef = useRef<Stroke | null>(null)

  const [tool, setTool] = useState<'pen' | 'eraser' | 'text'>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(WIDTHS[1])
  const [keepBackground, setKeepBackground] = useState(true)
  const [typing, setTyping] = useState<{ at: Point; value: string } | null>(null)
  const [, redraw] = useState(0)

  // Everything is kept as marks and replayed, so undo is a pop and the
  // background toggle is free. Snapshots would have been simpler and cost
  // five megabytes a step at this size.
  const render = useCallback(() => {
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
      if (mark.tool === 'text') {
        inkContext.globalCompositeOperation = 'source-over'
        inkContext.fillStyle = mark.color
        inkContext.font = `600 ${mark.size}px system-ui, "Noto Sans TC", sans-serif`
        inkContext.textBaseline = 'top'
        mark.text.split('\n').forEach((line, index) => {
          inkContext.fillText(line, mark.at.x, mark.at.y + index * mark.size * 1.3)
        })
        continue
      }
      // The eraser cuts a hole in the student's own layer, so it removes marks
      // without punching through to the picture behind them.
      inkContext.globalCompositeOperation = mark.tool === 'eraser' ? 'destination-out' : 'source-over'
      inkContext.strokeStyle = mark.color
      inkContext.lineWidth = mark.width
      inkContext.beginPath()
      const [first, ...rest] = mark.points
      if (!first) continue
      if (!rest.length) {
        // A tap with no movement is still a dot, which is what a student
        // expects when they put the pen down and lift it again.
        inkContext.arc(first.x, first.y, mark.width / 2, 0, Math.PI * 2)
        inkContext.fillStyle = mark.color
        inkContext.fill()
        continue
      }
      inkContext.moveTo(first.x, first.y)
      for (const point of rest) inkContext.lineTo(point.x, point.y)
      inkContext.stroke()
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

  function pointFrom(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const canvas = event.currentTarget
    const box = canvas.getBoundingClientRect()
    return {
      x: ((event.clientX - box.left) / box.width) * CANVAS.width,
      y: ((event.clientY - box.top) / box.height) * CANVAS.height,
    }
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (busy) return
    const at = pointFrom(event)
    if (tool === 'text') {
      setTyping({ at, value: '' })
      return
    }
    drawingRef.current = { tool, color, width: tool === 'eraser' ? width * 3 : width, points: [at] }
    // Capture keeps a stroke going when the finger slides off the canvas, but
    // it throws if the pointer is not active — and it was doing that before
    // the stroke was recorded, so a throw meant nothing was drawn at all. The
    // stroke is started first, and losing capture only costs the tail of a
    // line that leaves the edge.
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Drawing works without it.
    }
    render()
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
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
    const canvas = event.currentTarget
    const box = canvas.getBoundingClientRect()
    for (const raw of events) {
      stroke.points.push({
        x: ((raw.clientX - box.left) / box.width) * CANVAS.width,
        y: ((raw.clientY - box.top) / box.height) * CANVAS.height,
      })
    }
    render()
  }

  function onPointerUp() {
    const stroke = drawingRef.current
    if (!stroke) return
    drawingRef.current = null
    marksRef.current = [...marksRef.current, stroke]
    render()
    redraw((count) => count + 1)
  }

  function commitText() {
    if (!typing) return
    const text = typing.value.trim()
    if (text) {
      marksRef.current = [...marksRef.current, {
        tool: 'text', color, size: Math.max(20, width * 4), at: typing.at, text,
      }]
    }
    setTyping(null)
    render()
    redraw((count) => count + 1)
  }

  function undo() {
    marksRef.current = marksRef.current.slice(0, -1)
    render()
    redraw((count) => count + 1)
  }

  function clearAll() {
    marksRef.current = []
    render()
    redraw((count) => count + 1)
  }

  async function send() {
    const canvas = canvasRef.current
    if (!canvas) return
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return
    await onSubmit(new File([blob], 'drawing.png', { type: 'image/png' }))
    clearAll()
  }

  const empty = marksRef.current.length === 0

  return (
    <div className="board-composer-body board-drawing">
      <div className="board-drawing-tools">
        <div className="board-drawing-group">
          <button
            aria-pressed={tool === 'pen'}
            className={tool === 'pen' ? 'is-selected' : 'ghost-button'}
            type="button"
            onClick={() => setTool('pen')}
          >
            <Pen size={16} />{participantText(locale, 'drawPen')}
          </button>
          <button
            aria-pressed={tool === 'eraser'}
            className={tool === 'eraser' ? 'is-selected' : 'ghost-button'}
            type="button"
            onClick={() => setTool('eraser')}
          >
            <Eraser size={16} />{participantText(locale, 'drawEraser')}
          </button>
          <button
            aria-pressed={tool === 'text'}
            className={tool === 'text' ? 'is-selected' : 'ghost-button'}
            type="button"
            onClick={() => setTool('text')}
          >
            <TypeIcon size={16} />{participantText(locale, 'drawText')}
          </button>
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
          <button className="ghost-button" disabled={empty} type="button" onClick={undo}>
            <RotateCcw size={16} />{participantText(locale, 'drawUndo')}
          </button>
          <button className="ghost-button" disabled={empty} type="button" onClick={clearAll}>
            <Trash2 size={16} />{participantText(locale, 'drawClear')}
          </button>
        </div>
      </div>

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
          onPointerLeave={onPointerUp}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        />
        {typing && (
          <div
            className="board-drawing-text-input"
            style={{ left: `${(typing.at.x / CANVAS.width) * 100}%`, top: `${(typing.at.y / CANVAS.height) * 100}%` }}
          >
            <input
              autoFocus
              placeholder={participantText(locale, 'drawTextPlaceholder')}
              value={typing.value}
              onBlur={commitText}
              onChange={(event) => setTyping({ ...typing, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitText()
                if (event.key === 'Escape') setTyping(null)
              }}
            />
          </div>
        )}
      </div>

      <button disabled={busy || empty} type="button" onClick={() => void send()}>
        {busy ? participantText(locale, 'boardUploading') : participantText(locale, 'boardPost')}
      </button>
    </div>
  )
}
