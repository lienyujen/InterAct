import type { Message, Session } from '../types'

type Props = {
  messages: Message[]
  session: Session
}

function stableMessageSeed(id: string) {
  let seed = 0
  for (let index = 0; index < id.length; index += 1) {
    seed = (seed * 31 + id.charCodeAt(index)) >>> 0
  }
  return seed
}

export function DanmakuLayer({ messages, session }: Props) {
  if (!session.danmaku_enabled) return null

  const visible = messages.slice(-24)

  return (
    <div className="danmaku-layer" aria-live="polite">
      {visible.map((message) => {
        const seed = stableMessageSeed(message.id)
        const lane = seed % 8
        const text = session.anonymous_enabled ? message.content : `${message.participant_name}: ${message.content}`
        return (
          <div
            className="danmaku-item"
            key={message.id}
            style={{
              top: `${8 + lane * 10}%`,
              animationDuration: `${12 + ((seed >>> 3) % 4) * 2}s`,
              animationDelay: `${((seed >>> 5) % 5) * 0.25}s`,
            }}
          >
            {text}
          </div>
        )
      })}
    </div>
  )
}
