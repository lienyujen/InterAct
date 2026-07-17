import { DoorOpen, Eye, EyeOff, MessageSquare, MonitorUp, Sparkles, Square, Users } from 'lucide-react'
import type { Participant, Session } from '../types'

type Props = {
  session: Session
  participants: Participant[]
  busy: boolean
  onToggleDanmaku: () => void
  onToggleAnonymous: () => void
  onCaptureScreen?: () => void
  onStopQuestion: () => void
  onGenerateExitTicket: () => void
  onEndClass: () => void
}

export function PresenterControlPanel({
  session,
  participants,
  busy,
  onToggleDanmaku,
  onToggleAnonymous,
  onCaptureScreen,
  onStopQuestion,
  onGenerateExitTicket,
  onEndClass,
}: Props) {
  return (
    <section className="panel control-panel">
      <div className="metric">
        <Users size={18} />
        <span>{participants.length} 人在線</span>
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
      </div>
      {onCaptureScreen && (
        <button type="button" onClick={onCaptureScreen} disabled={busy}>
          <MonitorUp size={16} />
          截圖派題
        </button>
      )}
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
