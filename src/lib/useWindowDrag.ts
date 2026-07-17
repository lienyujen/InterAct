import { useRef } from 'react'
import type { PointerEventHandler } from 'react'

export function useWindowDrag() {
  const activePointerId = useRef<number | null>(null)

  const onPointerDown: PointerEventHandler<HTMLElement> = (event) => {
    if (!window.interactDesktop || !event.isPrimary || activePointerId.current !== null) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return

    activePointerId.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    window.interactDesktop.startWindowDrag(event.screenX, event.screenY)
    event.preventDefault()
  }

  const onPointerMove: PointerEventHandler<HTMLElement> = (event) => {
    if (activePointerId.current !== event.pointerId) return
    window.interactDesktop?.moveWindowDrag(event.screenX, event.screenY)
    event.preventDefault()
  }

  const finishDrag: PointerEventHandler<HTMLElement> = (event) => {
    if (activePointerId.current !== event.pointerId) return
    activePointerId.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    window.interactDesktop?.endWindowDrag()
    event.preventDefault()
  }

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onLostPointerCapture: finishDrag,
  }
}
