import { BellRing, Cloud, Dice5, DoorOpen, Eye, EyeOff, MessageSquare, MonitorUp, Send, Sparkles, Square, Users } from 'lucide-react'
import type { Session } from '../types'

type Props = {
  session: Session
  onlineCount: number
  busy: boolean
  buzzerActive: boolean
  onToggleDanmaku: () => void
  onToggleAnonymous: () => void
  onCaptureScreen?: () => void
  onDrawLottery: () => void
  onStartBuzzer: () => void
  onOpenTextDispatch: () => void
  onOpenWordCloud: () => void
  onStopQuestion: () => void
  onGenerateExitTicket: () => void
  onEndClass: () => void
}

export function PresenterControlPanel({
  session,
  onlineCount,
  busy,
  buzzerActive,
  onToggleDanmaku,
  onToggleAnonymous,
  onCaptureScreen,
  onDrawLottery,
  onStartBuzzer,
  onOpenTextDispatch,
  onOpenWordCloud,
  onStopQuestion,
  onGenerateExitTicket,
  onEndClass,
}: Props) {
  return (
    <section className="panel control-panel">
      <div className="metric-row">
        <div className="metric">
          <Users size={18} />
          <span>{onlineCount} 人在線</span>
        </div>
        <div className="metric-actions">
          <button
            aria-label="開始搶答"
            className={`ghost-button metric-action buzzer-menu-button${buzzerActive ? ' active' : ''}`}
            disabled={busy || !onlineCount}
            title={onlineCount ? (buzzerActive ? '重新開始搶答' : '開始搶答') : '目前沒有在線學員'}
            type="button"
            onClick={onStartBuzzer}
          >
            <BellRing size={19} />
          </button>
          <button
            aria-label="抽籤"
            className="ghost-button metric-action"
            disabled={busy || !onlineCount}
            title={onlineCount ? '從在線學員中抽籤' : '目前沒有在線學員'}
            type="button"
            onClick={onDrawLottery}
          >
            <Dice5 size={19} />
          </button>
        </div>
      </div>
      <div className="control-toggle-row">
        <button type="button" onClick={onToggleDanmaku} disabled={busy}>
          {session.danmaku_enabled ? <EyeOff size={16} /> : <Eye size={16} />}
          {session.danmaku_enabled ? '關閉彈幕' : '開啟彈幕'}
        </button>
        <button type="button" onClick={onToggleAnonymous} disabled={busy}>
          <MessageSquare size={16} />
          {session.anonymous_enabled ? '取消匿名' : '啟用匿名'}
        </button>
        <button type="button" onClick={onOpenWordCloud} disabled={busy}>
          <Cloud size={16} />
          彈幕文字雲
        </button>
      </div>
      {onCaptureScreen && (
        <button type="button" onClick={onCaptureScreen} disabled={busy}>
          <MonitorUp size={16} />
          截圖派題
        </button>
      )}
      <button type="button" onClick={onOpenTextDispatch} disabled={busy}>
        <Send size={16} />
        文字派送
      </button>
      <button type="button" onClick={onStopQuestion} disabled={busy || !session.current_question_id}>
        <Square size={16} />
        停止作答
      </button>
      <button type="button" onClick={onGenerateExitTicket} disabled={busy || Boolean(session.exit_ticket_prompt)}>
        <Sparkles size={16} />
        {session.exit_ticket_prompt ? 'Exit Ticket 已派送' : 'AI 生成並派送 Exit Ticket'}
      </button>
      <button className="end-class-button" type="button" onClick={onEndClass} disabled={busy}>
        <DoorOpen size={16} />
        下課並產生報告
      </button>
    </section>
  )
}
