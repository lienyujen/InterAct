import { AlertTriangle, GripVertical, Hand, Minus, MonitorUp } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'

type Props = {
  busy: boolean
  onlineCount: number
  raisedCount: number
  recording: boolean
  recordingStarting: boolean
  error: string
  notice: string
  hasQuestion: boolean
  submittedCount: number
  onCapture: () => void
  onJoin: () => void
  onResults: () => void
  onPanel: () => void
  onRoster: () => void
  onMinimize: () => void
}

export function PresenterToolbar({ busy, onlineCount, raisedCount, recording, recordingStarting, error, notice,
  hasQuestion, submittedCount, onCapture, onJoin, onResults, onPanel, onRoster, onMinimize }: Props) {
  const [online, setOnline] = useState(() => navigator.onLine)
  const toolbarRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current
    const desktop = window.interactDesktop
    if (!toolbar || !desktop) return
    let previousWidth = 0
    let active = true
    const resize = () => {
      if (!active) return
      // Match the intrinsic row plus the presenter's 5px inset on both sides.
      const width = Math.ceil(toolbar.getBoundingClientRect().width) + 10
      if (width === previousWidth) return
      previousWidth = width
      void desktop.setPresenterExpanded(false, false, false, 'toolbar', width)
        .catch(error => console.error('Toolbar resize failed', error))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(toolbar)
    return () => { active = false; observer.disconnect() }
  }, [])
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])
  const warning = !online ? '網路離線，請檢查連線。' : error
  const status = warning ? '請查看提示' : busy ? '處理中…' : recordingStarting ? '錄製連線中' : recording ? '● 錄製中' : notice || '授課中'

  return (
    <section aria-label="InterAct 授課工具列" className="presenter-toolbar" ref={toolbarRef}>
      <div className="presenter-toolbar-drag" title="拖曳移動工具列">
        <GripVertical size={16} />
        <span><strong>InterAct</strong><small role="status" title={status}>{status}</small></span>
      </div>
      <button className="presenter-toolbar-roster" onClick={onRoster} type="button" title="開啟班級名單">
        線上 {onlineCount}
        {raisedCount > 0 && <span className="presenter-toolbar-hands" title={`${raisedCount} 人舉手`}><Hand size={18} strokeWidth={2.5} />{raisedCount}</span>}
      </button>
      <button className="presenter-toolbar-capture" disabled={busy || !online} onClick={onCapture} type="button">
        <MonitorUp size={17} />截圖派題
      </button>
      <button disabled={busy} onClick={onJoin} type="button">加入</button>
      <button disabled={busy || !hasQuestion} onClick={onResults} type="button">{hasQuestion ? `已繳交 ${submittedCount} 人｜查看結果` : '查看結果'}</button>
      <button aria-label={warning ? `完整面板：${warning}` : '完整面板'} className={warning ? 'has-warning' : undefined}
        onClick={onPanel} title={warning || '開啟全部功能與課堂設定'} type="button">
        {warning && <AlertTriangle size={16} />}{!online ? '網路離線' : '完整面板'}
      </button>
      <button aria-label="最小化" className="presenter-toolbar-minimize" onClick={onMinimize} title="最小化" type="button"><Minus size={17} /></button>
      {warning && <span className="presenter-toolbar-warning" role="alert">{warning}</span>}
    </section>
  )
}
