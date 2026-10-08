import { Eye, EyeOff, UserRound, UserRoundX, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BoardWall } from '../components/BoardWall'
import { boardAction, loadBoard } from '../lib/boardData'
import type { BoardSnapshot } from '../lib/boardData'
import { requireSupabase } from '../lib/supabase'
import { createCoalescedLoader } from '../lib/coalescedLoad'

// The whole wall on the whole screen, in its own window. It runs with no
// presenter page underneath it, so it fetches its own copy rather than being
// handed one — the same arrangement as the enlarged 圖上點選 window.
export function BoardReviewPage() {
  const { sessionId = '', questionId = '' } = useParams()
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [anonymous, setAnonymous] = useState(true)
  const reload = useRef(createCoalescedLoader())

  const read = useCallback(() => reload.current(async () => {
    if (navigator.onLine === false) return
    try {
      const [board, { data, error: sessionError }] = await Promise.all([
        loadBoard(sessionId, questionId),
        requireSupabase().from('sessions').select('anonymous_enabled').eq('id', sessionId).single(),
      ])
      if (sessionError) throw sessionError
      setSnapshot(board)
      setAnonymous(data?.anonymous_enabled !== false)
      setError('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '讀取討論板失敗。')
    }
  }), [questionId, sessionId])

  useEffect(() => {
    void read()
    const timer = window.setInterval(() => void read(), 10_000)
    return () => window.clearInterval(timer)
  }, [read])

  useEffect(() => {
    const supabase = requireSupabase()
    const channel = supabase.channel(`board-review-settings:${sessionId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, () => void read())
      .subscribe()
    const onOnline = () => void read()
    window.addEventListener('online', onOnline)
    return () => { window.removeEventListener('online', onOnline); void supabase.removeChannel(channel) }
  }, [read, sessionId])

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
          <button className="ghost-button" aria-pressed={anonymous} disabled={busy || !snapshot} type="button"
            onClick={() => void run({ action: 'update_session', anonymousEnabled: !anonymous })}>
            {anonymous ? <UserRoundX size={16} /> : <UserRound size={16} />}
            {anonymous ? '取消匿名' : '開啟匿名'}
          </button>
          <button
            className="ghost-button"
            disabled={busy || !question}
            type="button"
            onClick={() => void run({ action: 'set_board_visibility', questionId, shared: !revealed })}
          >
            {revealed ? <><EyeOff size={16} />自行作答</> : <><Eye size={16} />開放瀏覽</>}
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
        anonymous={anonymous}
        busy={busy}
        posts={snapshot?.posts || []}
        reactions={snapshot?.reactions || []}
        onSetState={(postId, patch) => void run({ action: 'set_board_post_state', postId, ...patch })}
      />
    </main>
  )
}
