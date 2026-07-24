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
          <span className="metric-icon"><Users size={18} /></span>
          <span>{onlineCount} 人在線</span>
        </div>
        <div className="metric-actions">
          <button
            aria-label="開始搶答"
            className={`ghost-button metric-action energy-action buzzer-menu-button${buzzerActive ? ' active' : ''}`}
            disabled={busy || !onlineCount}
            title={onlineCount ? (buzzerActive ? '重新開始搶答' : '開始搶答') : '目前沒有在線學員'}
            type="button"
            onClick={onStartBuzzer}
          >
            <BellRing size={19} />
          </button>
          <button
            aria-label="抽籤"
            className="ghost-button metric-action energy-action"
            disabled={busy || !onlineCount}
            title={onlineCount ? '從在線學員中抽籤' : '目前沒有在線學員'}
            type="button"
            onClick={onDrawLottery}
          >
            <Dice5 size={19} />
          </button>
        </div>
      </div>

      <div className="control-section">
        <p className="control-section-label"><Eye size={15} />課堂設定</p>
        <div className="control-toggle-row">
          <button
            aria-pressed={session.danmaku_enabled}
            className={`control-toggle${session.danmaku_enabled ? ' is-active' : ''}`}
            type="button"
            onClick={onToggleDanmaku}
            disabled={busy}
          >
            {session.danmaku_enabled ? <Eye size={16} /> : <EyeOff size={16} />}
            <span>彈幕</span>
            <b>{session.danmaku_enabled ? '開啟' : '關閉'}</b>
          </button>
          <button
            aria-pressed={session.anonymous_enabled}
            className={`control-toggle${session.anonymous_enabled ? ' is-active' : ''}`}
            type="button"
            onClick={onToggleAnonymous}
            disabled={busy}
          >
            <MessageSquare size={16} />
            <span>匿名</span>
            <b>{session.anonymous_enabled ? '開啟' : '關閉'}</b>
          </button>
        </div>
      </div>

      <div className="control-section">
        <p className="control-section-label"><MonitorUp size={15} />分享內容</p>
        <div className="control-action-grid">
          {onCaptureScreen && (
            <button className="control-action share-action" type="button" onClick={onCaptureScreen} disabled={busy}>
              <span className="control-action-icon"><MonitorUp size={18} /></span>
              截圖派題
            </button>
          )}
          <button className="control-action share-action" type="button" onClick={onOpenTextDispatch} disabled={busy}>
            <span className="control-action-icon"><Send size={18} /></span>
            文字派送
          </button>
          <button className="control-action energy-control-action" type="button" onClick={onOpenWordCloud} disabled={busy}>
            <span className="control-action-icon"><Cloud size={18} /></span>
            彈幕文字雲
          </button>
        </div>
      </div>

      <div className="control-section">
        <p className="control-section-label"><Sparkles size={15} />課堂收尾</p>
        <div className="control-footer-actions">
          <button className="stop-question-button" type="button" onClick={onStopQuestion} disabled={busy || !session.current_question_id}>
            <Square size={16} />
            停止作答
          </button>
          <button className="exit-ticket-button" type="button" onClick={onGenerateExitTicket} disabled={busy || Boolean(session.exit_ticket_prompt)}>
            <Sparkles size={17} />
            {session.exit_ticket_prompt ? 'Exit Ticket 已派送' : 'AI 生成 Exit Ticket'}
          </button>
        </div>
      </div>

      <button className="end-class-button" type="button" onClick={onEndClass} disabled={busy}>
        <DoorOpen size={16} />
        下課並產生報告
      </button>
    </section>
  )
}
