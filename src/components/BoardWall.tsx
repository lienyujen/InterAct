import { Download, Eye, EyeOff, Pin, PinOff } from 'lucide-react'
import { repliesByParent, sortedBoardPosts } from '../lib/boardData'
import type { BoardPost, BoardReaction } from '../types'

type Props = {
  anonymous: boolean
  posts: BoardPost[]
  reactions: BoardReaction[]
  // Null in the side panel, where the cards are thumbnails and there is no
  // room for controls on each one.
  onSetState: ((postId: string, patch: { hidden?: boolean; pinned?: boolean }) => void) | null
  busy?: boolean
}

// One wall, drawn the same way in the panel beside the class list and in the
// window that fills the screen. The only difference is whether each card
// carries its moderation controls, which is what onSetState decides.
export function BoardWall({ anonymous, busy, posts, reactions, onSetState }: Props) {
  const cards = sortedBoardPosts(posts)
  const replies = repliesByParent(posts)

  if (!cards.length) return <p className="muted">還沒有人貼東西。</p>

  return (
    <div className="board-wall">
      {cards.map((card) => {
        const own = reactions.filter((entry) => entry.post_id === card.id)
        const tally = new Map<string, number>()
        for (const entry of own) tally.set(entry.emoji, (tally.get(entry.emoji) || 0) + 1)
        const childReplies = replies.get(card.id) || []
        return (
          <article
            className={`board-wall-card${card.hidden_at ? ' is-hidden' : ''}${card.deleted_at ? ' is-withdrawn' : ''}${card.pinned_at ? ' is-pinned' : ''}`}
            key={card.id}
          >
            <header>
              {/* The presenter always sees the name. Anonymity is what the
                  class was shown, not a fact about the card, and the person
                  giving out points has to know whose work it is. */}
              <strong>{card.participant_name}</strong>
              {anonymous && <span className="board-wall-tag">班上匿名</span>}
              {card.deleted_at && <span className="board-wall-tag">學生收回</span>}
              {card.hidden_at && <span className="board-wall-tag">已收起</span>}
            </header>

            {card.kind === 'text' && <p className="board-wall-text">{card.body}</p>}
            {card.kind === 'link' && card.url && (
              <a className="board-wall-link" href={card.url} rel="noreferrer noopener" target="_blank">{card.url}</a>
            )}
            {card.kind === 'image' && card.public_url && (
              <a href={card.public_url} rel="noreferrer noopener" target="_blank">
                <img alt="" className="board-wall-image" src={card.public_url} />
              </a>
            )}
            {card.kind === 'file' && card.public_url && (
              <a className="board-wall-file" download href={card.public_url}>
                <Download size={16} />{card.storage_path?.split('/').pop()}
              </a>
            )}
            {card.kind === 'audio' && card.public_url && <audio controls preload="none" src={card.public_url} />}

            {tally.size > 0 && (
              <div className="board-wall-reactions">
                {[...tally].map(([emoji, count]) => <span key={emoji}>{emoji} {count}</span>)}
              </div>
            )}

            {childReplies.length > 0 && (
              <ul className="board-wall-replies">
                {childReplies.map((reply) => (
                  <li key={reply.id}><strong>{reply.participant_name}</strong>{reply.body}</li>
                ))}
              </ul>
            )}

            {onSetState && (
              <footer className="board-wall-actions">
                <button
                  disabled={busy}
                  title={card.pinned_at ? '取消置頂' : '置頂'}
                  type="button"
                  onClick={() => onSetState(card.id, { pinned: !card.pinned_at })}
                >
                  {card.pinned_at ? <PinOff size={15} /> : <Pin size={15} />}
                </button>
                <button
                  disabled={busy}
                  title={card.hidden_at ? '重新顯示' : '對全班收起'}
                  type="button"
                  onClick={() => onSetState(card.id, { hidden: !card.hidden_at })}
                >
                  {card.hidden_at ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </footer>
            )}
          </article>
        )
      })}
    </div>
  )
}
