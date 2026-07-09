import type { Message, Session } from '../types'

type Props = {
  messages: Message[]
  session: Session
}

export function DanmakuLayer({ messages, session }: Props) {
  if (!session.danmaku_enabled) return null

  const visible = messages.slice(-24)

  return (
    <div className="danmaku-layer" aria-live="polite">
      {visible.map((message, index) => {
        const lane = index % 8
        const text = session.anonymous_enabled ? message.content : `${message.participant_name}: ${message.content}`
        return (
          <div
            className="danmaku-item"
            key={message.id}
            style={{
              top: `${8 + lane * 10}%`,
              animationDuration: `${12 + (index % 4) * 2}s`,
              animationDelay: `${(index % 5) * 0.25}s`,
            }}
          >
            {text}
          </div>
        )
      })}
    </div>
  )
}
