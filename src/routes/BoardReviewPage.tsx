import { Eye, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BoardWall } from '../components/BoardWall'
import { boardAction, loadBoard } from '../lib/boardData'
import type { BoardSnapshot } from '../lib/boardData'

// The whole wall on the whole screen, in its own window. It runs with no
// presenter page underneath it, so it fetches its own copy rather than being
// handed one — the same arrangement as the enlarged 圖上點選 window.
export function BoardReviewPage() {
  const { sessionId = '', questionId = '' } = useParams()
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const read = useCallback(async () => {
    try {
      setSnapshot(await loadBoard(sessionId, questionId))
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '讀取討論板失敗。')
    }
  }, [questionId, sessionId])

  useEffect(() => {
    void read()
    const timer = window.setInterval(() => void read(), 10_000)
    return () => window.clearInterval(timer)
  }, [read])

  async function run(body: Record<string, unknown>) {
    setBusy(true)
    try {
      await boardAction(sessionId, body)
      await read()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失敗。')
    } finally {
      setBusy(false)
    }
  }

  const question = snapshot?.question
  const revealed = Boolean(question?.board_revealed_at)
  const live = (snapshot?.posts || []).filter((post) => !post.reply_to && !post.deleted_at)
  const contributors = new Set(live.map((post) => post.participant_id)).size

  return (
    <main className="board-review-page">
      <header className="board-review-heading">
        <div>
          <h1>{question?.title || '討論板'}</h1>
          {question?.prompt_text && <p>{question.prompt_text}</p>}
        </div>
        <div className="board-review-actions">
          <span className="muted">{live.length} 則 · {contributors} 人</span>
          <button
            className={revealed ? 'ghost-button' : ''}
            disabled={busy || revealed || !question}
            type="button"
            onClick={() => void run({ action: 'reveal_board', questionId })}
          >
            <Eye size={16} />{revealed ? '全班已可瀏覽' : '開放瀏覽'}
          </button>
          {/* This window draws its own frame, so it draws its own way out. */}
          <button
            aria-label="關閉討論板視窗"
            className="icon-button"
            title="關閉"
            type="button"
            onClick={() => window.interactDesktop?.close()}
          >
            <X size={24} />
          </button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {!revealed && question && <p className="muted">學生現在只看得到自己貼的。</p>}
      {question?.share_screenshot && snapshot?.imageUrl && (
        <img alt="討論板主題" className="board-review-image" src={snapshot.imageUrl} />
      )}
      <BoardWall
        anonymous={Boolean(snapshot?.posts.some((post) => post.anonymous_at_display))}
        busy={busy}
        posts={snapshot?.posts || []}
        reactions={snapshot?.reactions || []}
        onSetState={(postId, patch) => void run({ action: 'set_board_post_state', postId, ...patch })}
      />
    </main>
  )
}
