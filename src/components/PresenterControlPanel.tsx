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
          <span>{onlineCount} ???</span>
        </div>
        <div className="metric-actions">
          <button
            aria-label="????"
            className={`ghost-button metric-action buzzer-menu-button${buzzerActive ? ' active' : ''}`}
            disabled={busy || !onlineCount}
            title={onlineCount ? (buzzerActive ? '??????' : '????') : '????????'}
            type="button"
            onClick={onStartBuzzer}
          >
            <BellRing size={19} />
          </button>
          <button
            aria-label="??"
            className="ghost-button metric-action"
            disabled={busy || !onlineCount}
            title={onlineCount ? '????????' : '????????'}
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
          {session.danmaku_enabled ? '????' : '????'}
        </button>
        <button type="button" onClick={onToggleAnonymous} disabled={busy}>
          <MessageSquare size={16} />
          {session.anonymous_enabled ? '????' : '????'}
        </button>
        <button type="button" onClick={onOpenWordCloud} disabled={busy}>
          <Cloud size={16} />
          ?????
        </button>
      </div>
      {onCaptureScreen && (
        <button type="button" onClick={onCaptureScreen} disabled={busy}>
          <MonitorUp size={16} />
          ????
        </button>
      )}
      <button type="button" onClick={onOpenTextDispatch} disabled={busy}>
        <Send size={16} />
        ????
      </button>
      <button type="button" onClick={onStopQuestion} disabled={busy || !session.current_question_id}>
        <Square size={16} />
        ????
      </button>
      <button type="button" onClick={onGenerateExitTicket} disabled={busy || Boolean(session.exit_ticket_prompt)}>
        <Sparkles size={16} />
        {session.exit_ticket_prompt ? 'Exit Ticket ???' : 'AI ????? Exit Ticket'}
      </button>
      <button className="end-class-button" type="button" onClick={onEndClass} disabled={busy}>
        <DoorOpen size={16} />
        ???????
      </button>
    </section>
  )
}
