import { Eye, EyeOff, ImageUp, MessageSquare, Square, Users } from 'lucide-react'
import type { Participant, Session } from '../types'

type Props = {
  session: Session
  participants: Participant[]
  busy: boolean
  onToggleDanmaku: () => void
  onToggleAnonymous: () => void
  onUploadImage: (file: File) => void
  onCreateChoiceQuestion: () => void
  onStopQuestion: () => void
}

export function PresenterControlPanel({
  session,
  participants,
  busy,
  onToggleDanmaku,
  onToggleAnonymous,
  onUploadImage,
  onCreateChoiceQuestion,
  onStopQuestion,
}: Props) {
  return (
    <section className="panel control-panel">
      <div className="metric">
        <Users size={18} />
        <span>{participants.length} 人在線</span>
      </div>
      <button type="button" onClick={onToggleDanmaku} disabled={busy}>
        {session.danmaku_enabled ? <EyeOff size={16} /> : <Eye size={16} />}
        {session.danmaku_enabled ? '關閉彈幕' : '開啟彈幕'}
      </button>
      <button type="button" onClick={onToggleAnonymous} disabled={busy}>
        <MessageSquare size={16} />
        {session.anonymous_enabled ? '取消匿名' : '啟用匿名'}
      </button>
      <label className="file-button">
        <ImageUp size={16} />
        派送圖片
        <input
          accept="image/*"
          disabled={busy}
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) onUploadImage(file)
            event.currentTarget.value = ''
          }}
        />
      </label>
      <button type="button" onClick={onCreateChoiceQuestion} disabled={busy}>
        <MessageSquare size={16} />
        建立選擇題
      </button>
      <button type="button" onClick={onStopQuestion} disabled={busy || !session.current_question_id}>
        <Square size={16} />
        停止作答
      </button>
    </section>
  )
}
