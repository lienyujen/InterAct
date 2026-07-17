import { GripHorizontal, Minus, X } from 'lucide-react'
import { useWindowDrag } from '../lib/useWindowDrag'

export function DesktopWindowChrome() {
  const dragHandlers = useWindowDrag()
  if (!window.interactDesktop) return null

  return (
    <header className="desktop-window-chrome">
      <div className="desktop-drag-handle" title="拖曳視窗" {...dragHandlers}>
        <GripHorizontal size={16} />
        <span>InterAct</span>
      </div>
      <div className="desktop-window-actions">
        <button aria-label="最小化" title="最小化" type="button" onClick={() => window.interactDesktop?.minimize()}>
          <Minus size={16} />
        </button>
        <button aria-label="關閉" title="關閉" type="button" onClick={() => window.interactDesktop?.close()}>
          <X size={16} />
        </button>
      </div>
    </header>
  )
}
