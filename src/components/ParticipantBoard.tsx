import { Download, Link2, Mic, Paperclip, PenTool, Pencil, Square, Trash2, Type as TypeIcon, Image as ImageIcon } from 'lucide-react'
import { BoardDrawing } from './BoardDrawing'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { boardFileName, isImageCard } from '../lib/boardCards'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { BoardPost, BoardPostKind, BoardReaction, Participant, Question, Session } from '../types'

type Props = {
  // The teacher is not online. The wall stays readable — taking it away would
  // remove the one thing the class can still usefully do — but nothing new is
  // accepted while there is nobody watching what arrives.
  locked: boolean
  locale: ParticipantLocale
  participant: Participant
  participantToken: string
  question: Question
  session: Session
  imageUrl: string | null
}

const REACTIONS = ['👍', '❤️', '🤔']

// Board uploads live in a public bucket, so an address is a string build
// rather than a round trip. The rows carry a storage path and nothing else:
// the edge function fills an address in on the way past, but the wall is read
// straight from the table, so it has to build its own. Without this every
// photograph, file and recording on the wall rendered as nothing at all.
function withPublicUrls(supabase: ReturnType<typeof requireSupabase>, posts: BoardPost[]) {
  return posts.map((post) => {
    if (post.public_url || !post.storage_path) return post
    const { data } = supabase.storage.from('interact-files').getPublicUrl(post.storage_path)
    return { ...post, public_url: data.publicUrl }
  })
}

// Long enough for a thought, short enough that thirty of them do not become an
// hour of listening for the presenter.
const MAX_RECORDING_MS = 120_000

const kindIcons: Record<BoardPostKind, typeof TypeIcon> = {
  text: TypeIcon,
  link: Link2,
  image: ImageIcon,
  file: Paperclip,
  audio: Mic,
  drawing: PenTool,
}

export function ParticipantBoard({ locale, locked, participant, participantToken, question, session, imageUrl }: Props) {
  const [mine, setMine] = useState<BoardPost[]>([])
  const [wall, setWall] = useState<BoardPost[]>([])
  const [reactions, setReactions] = useState<BoardReaction[]>([])
  const [composing, setComposing] = useState<BoardPostKind | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [replyTo, setReplyTo] = useState<string | null>(null)
  const [replyDraft, setReplyDraft] = useState('')
  // Which card or reply is open for correction, and what it currently says.
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  const revealed = Boolean(question.board_revealed_at)
  // Whether anything new may be written. Closing discussion and the teacher
  // going offline both stop it.
  const open = question.status === 'active' && !locked
  // Reactions outlive the discussion. A closed board is still worth reading,
  // and saying so with a tap costs the database one tiny row — it is the
  // writing of new cards and replies that closing is meant to stop.
  const canReact = revealed && !locked
  const formats = question.board_formats || []
  const limit = question.board_max_posts
  // Deleted cards do not count, and replies never did. This has to match
  // board_card_count in the schema exactly: the policy is what actually
  // decides, so a page that counted differently would either hide the composer
  // from someone who is allowed to post or offer it to someone who is not.
  const usedCount = mine.filter((post) => !post.reply_to && !post.deleted_at).length
  const full = limit !== null && usedCount >= limit

  const invoke = useCallback(async (body: Record<string, unknown>) => {
    const { data, error: invokeError } = await requireSupabase().functions.invoke('participant-action', {
      body: { sessionId: session.id, participantId: participant.id, participantToken, ...body },
    })
    if (invokeError) throw invokeError
    if (data?.message && !data?.ok && !data?.posts && !('reacted' in (data || {}))) throw new Error(data.message)
    return data
  }, [participant.id, participantToken, session.id])

  const loadMine = useCallback(async () => {
    try {
      const data = await invoke({ action: 'get_my_board_posts', questionId: question.id })
      setMine((data?.posts || []) as BoardPost[])
    } catch {
      // A card that was just posted is already on screen; a failed refresh is
      // not worth an error message over the composer.
    }
  }, [invoke, question.id])

  // The wall itself is only readable once the presenter has revealed it — the
  // policy says so, not the page — so this returns nothing until then and does
  // not have to be guarded here.
  const loadWall = useCallback(async () => {
    if (!isSupabaseConfigured || !revealed) return
    const supabase = requireSupabase()
    const [{ data: posts }, { data: reacted }] = await Promise.all([
      supabase.from('board_posts').select('*').eq('question_id', question.id).order('created_at'),
      supabase.from('board_reactions').select('post_id, participant_id, emoji'),
    ])
    setWall(withPublicUrls(supabase, (posts || []) as BoardPost[]))
    setReactions((reacted || []) as BoardReaction[])
  }, [question.id, revealed])

  useEffect(() => { void loadMine() }, [loadMine])
  useEffect(() => { void loadWall() }, [loadWall])

  useEffect(() => {
    if (!isSupabaseConfigured || !revealed) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`board:${question.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_posts', filter: `question_id=eq.${question.id}` }, () => { void loadWall() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_reactions', filter: `session_id=eq.${session.id}` }, () => { void loadWall() })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [loadWall, question.id, revealed, session.id])

  // A card is written straight to the table, the way a danmaku message is, so
  // it is on the wall the moment it is sent rather than after a round trip
  // through a function that would only repeat what the policy already checks.
  const post = useCallback(async (card: Partial<BoardPost> & { kind: BoardPostKind }) => {
    const { error: insertError } = await requireSupabase().from('board_posts').insert({
      session_id: session.id,
      question_id: question.id,
      participant_id: participant.id,
      participant_name: participant.name,
      anonymous_at_display: session.anonymous_enabled,
      ...card,
    })
    if (insertError) throw insertError
    await loadMine()
    await loadWall()
  }, [loadMine, loadWall, participant.id, participant.name, question.id, session.anonymous_enabled, session.id])

  async function submitText() {
    const body = draft.trim()
    if (!body) return
    setBusy(true)
    setError('')
    try {
      await post({ kind: 'text', body })
      setDraft('')
      setComposing(null)
    } catch {
      setError(full ? participantText(locale, 'boardFull') : participantText(locale, 'boardOpenFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function submitLink() {
    const raw = draft.trim()
    if (!raw) return
    // A student typing an address rarely types the scheme, and a card whose
    // link does not open is worse than no card.
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    setBusy(true)
    setError('')
    try {
      await post({ kind: 'link', url, body: null })
      setDraft('')
      setComposing(null)
    } catch {
      setError(full ? participantText(locale, 'boardFull') : participantText(locale, 'boardOpenFailed'))
    } finally {
      setBusy(false)
    }
  }

  const upload = useCallback(async (kind: BoardPostKind, file: File, durationMs?: number) => {
    const prepared = await invoke({
      action: 'prepare_board_upload',
      questionId: question.id,
      kind,
      fileName: file.name,
      fileSize: file.size,
    })
    const { error: uploadError } = await requireSupabase().storage
      .from('interact-files')
      .uploadToSignedUrl(prepared.storagePath, prepared.uploadToken, file)
    if (uploadError) throw uploadError
    await post({
      kind,
      body: null,
      storage_path: prepared.storagePath,
      mime_type: file.type || 'application/octet-stream',
      file_size: file.size,
      duration_ms: durationMs ?? null,
    })
  }, [invoke, post, question.id])

  async function pickFile(kind: BoardPostKind, file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await upload(kind, file)
      setComposing(null)
    } catch {
      setError(full ? participantText(locale, 'boardFull') : participantText(locale, 'boardOpenFailed'))
    } finally {
      setBusy(false)
    }
  }

  function startEdit(post: BoardPost) {
    setEditing(post.id)
    // A link card keeps its address in url and nothing in body, so that is the
    // text the student is looking at and the text they mean to change.
    setEditDraft(post.kind === 'link' ? post.url || '' : post.body || '')
  }

  async function submitEdit(postId: string) {
    const body = editDraft.trim()
    if (!body) return
    setBusy(true)
    try {
      await invoke({ action: 'edit_board_post', postId, body })
      setEditing(null)
      setEditDraft('')
      await loadMine()
      await loadWall()
    } catch {
      setError(participantText(locale, 'boardOpenFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function withdraw(postId: string) {
    setBusy(true)
    try {
      await invoke({ action: 'withdraw_board_post', postId })
      await loadMine()
      await loadWall()
    } catch {
      setError(participantText(locale, 'boardOpenFailed'))
    } finally {
      setBusy(false)
    }
  }

  async function react(postId: string, emoji: string) {
    try {
      await invoke({ action: 'toggle_board_reaction', postId, emoji })
      await loadWall()
    } catch {
      // A like that did not land is not worth interrupting the class over.
    }
  }

  async function submitReply(parentId: string) {
    const body = replyDraft.trim()
    if (!body) return
    setBusy(true)
    try {
      await post({ kind: 'text', body, reply_to: parentId })
      setReplyDraft('')
      setReplyTo(null)
    } catch {
      setError(participantText(locale, 'boardOpenFailed'))
    } finally {
      setBusy(false)
    }
  }

  // Before the reveal a student sees their own cards and nothing else; after
  // it, the wall — with their own withdrawn cards still shown to them, so the
  // count they are given adds up to what they can see.
  const visible = useMemo(() => {
    const source = revealed ? wall : mine
    const shown = source.filter((card) => !card.reply_to && !card.hidden_at && (!card.deleted_at || card.participant_id === participant.id))
    return [...shown].sort((left, right) => {
      const pinned = Number(Boolean(right.pinned_at)) - Number(Boolean(left.pinned_at))
      if (pinned) return pinned
      return left.created_at.localeCompare(right.created_at)
    })
  }, [mine, participant.id, revealed, wall])

  const repliesOf = useMemo(() => {
    const byParent = new Map<string, BoardPost[]>()
    for (const card of wall) {
      if (!card.reply_to || card.hidden_at || card.deleted_at) continue
      byParent.set(card.reply_to, [...(byParent.get(card.reply_to) || []), card])
    }
    return byParent
  }, [wall])

  return (
    <section className="panel participant-board">
      <div className="participant-board-heading">
        <h2>{participantText(locale, 'board')}</h2>
        <span className="participant-board-count">
          {limit === null
            ? participantText(locale, 'boardUnlimited')
            : participantText(locale, 'boardCount')
              .replace('{used}', String(usedCount))
              .replace('{limit}', String(limit))}
        </span>
      </div>
      {question.prompt_text && <p className="participant-board-topic">{question.prompt_text}</p>}
      {imageUrl && question.share_screenshot && (
        <img alt={participantText(locale, 'board')} className="participant-board-image" src={imageUrl} />
      )}

      {locked && (
        <p className="muted">
          {session.status === 'ended'
            ? participantText(locale, 'boardAfterClass')
            : participantText(locale, 'boardPausedWhileAway')}
        </p>
      )}
      {!open && !locked && <p className="muted">{participantText(locale, 'boardClosed')}</p>}
      {open && !revealed && <p className="muted">{participantText(locale, 'boardYoursOnly')}</p>}
      {error && <p className="error">{error}</p>}

      {open && !full && (
        <div className="board-composer">
          <div className="board-composer-tabs">
            {formats.map((kind) => {
              const Icon = kindIcons[kind]
              const labels: Record<BoardPostKind, string> = {
                drawing: participantText(locale, 'boardDrawing'),
                text: participantText(locale, 'boardWrite'),
                link: participantText(locale, 'boardLink'),
                image: participantText(locale, 'boardImage'),
                file: participantText(locale, 'boardFile'),
                audio: participantText(locale, 'boardAudio'),
              }
              return (
                <button
                  aria-pressed={composing === kind}
                  className={`board-composer-tab${composing === kind ? ' is-selected' : ''}`}
                  disabled={busy}
                  key={kind}
                  type="button"
                  onClick={() => { setComposing(composing === kind ? null : kind); setDraft('') }}
                >
                  <Icon size={18} />{labels[kind]}
                </button>
              )
            })}
          </div>

          {composing === 'text' && (
            <div className="board-composer-body">
              <textarea
                maxLength={1000}
                placeholder={participantText(locale, 'boardPlaceholder')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button disabled={busy || !draft.trim()} type="button" onClick={submitText}>
                {busy ? participantText(locale, 'boardPosting') : participantText(locale, 'boardPost')}
              </button>
            </div>
          )}

          {composing === 'link' && (
            <div className="board-composer-body">
              <input
                inputMode="url"
                placeholder={participantText(locale, 'boardLinkPlaceholder')}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button disabled={busy || !draft.trim()} type="button" onClick={submitLink}>
                {busy ? participantText(locale, 'boardPosting') : participantText(locale, 'boardPost')}
              </button>
            </div>
          )}

          {composing === 'image' && (
            <div className="board-composer-body">
              <label className="board-file-pick">
                {/* capture asks a phone for its camera directly rather than the
                    photo roll, which is what a student in a classroom almost
                    always wants. A laptop ignores it and shows the ordinary
                    file picker. */}
                <input
                  accept="image/*"
                  capture="environment"
                  type="file"
                  onChange={(event) => void pickFile('image', event.target.files?.[0])}
                />
                <span>{busy ? participantText(locale, 'boardUploading') : participantText(locale, 'boardPickImage')}</span>
              </label>
            </div>
          )}

          {composing === 'file' && (
            <div className="board-composer-body">
              <label className="board-file-pick">
                <input type="file" onChange={(event) => void pickFile('file', event.target.files?.[0])} />
                <span>{busy ? participantText(locale, 'boardUploading') : participantText(locale, 'boardPickFile')}</span>
              </label>
            </div>
          )}

          {composing === 'drawing' && (
            <BoardDrawing
              backgroundUrl={question.share_screenshot ? imageUrl : null}
              busy={busy}
              locale={locale}
              onSubmit={async (file) => {
                setBusy(true)
                setError('')
                try {
                  await upload('drawing', file)
                  setComposing(null)
                } catch (caught) {
                  setError(full ? participantText(locale, 'boardFull') : participantText(locale, 'boardOpenFailed'))
                  // Rethrown so the board keeps the drawing. It clears its
                  // canvas when this resolves, and swallowing the failure
                  // here threw away the very thing the error message asks
                  // the student to send again.
                  throw caught
                } finally {
                  setBusy(false)
                }
              }}
            />
          )}
          {composing === 'audio' && (
            <BoardRecorder
              busy={busy}
              locale={locale}
              onRecorded={async (file, durationMs) => {
                setBusy(true)
                setError('')
                try {
                  await upload('audio', file, durationMs)
                  setComposing(null)
                } catch {
                  setError(participantText(locale, 'boardOpenFailed'))
                } finally {
                  setBusy(false)
                }
              }}
            />
          )}
        </div>
      )}
      {open && full && <p className="muted">{participantText(locale, 'boardFull')}</p>}

      <div className="board-cards">
        {!visible.length && (
          <p className="muted">
            {revealed ? participantText(locale, 'boardEmpty') : participantText(locale, 'boardYoursEmpty')}
          </p>
        )}
        {visible.map((card) => (
          <BoardCard
            anonymous={session.anonymous_enabled}
            card={card}
            key={card.id}
            readOnly={locked}
            locale={locale}
            mine={card.participant_id === participant.id}
            reactions={reactions.filter((entry) => entry.post_id === card.id)}
            replies={repliesOf.get(card.id) || []}
            canReact={canReact}
            canReply={canReact && open}
            viewerId={participant.id}
            onReact={(emoji) => void react(card.id, emoji)}
            onReply={() => { setReplyTo(replyTo === card.id ? null : card.id); setReplyDraft('') }}
            onWithdraw={() => void withdraw(card.id)}
            editingId={editing}
            editDraft={editDraft}
            onEditStart={startEdit}
            onEditDraft={setEditDraft}
            onEditCancel={() => { setEditing(null); setEditDraft('') }}
            onEditSubmit={(postId) => void submitEdit(postId)}
            replying={replyTo === card.id}
            replyDraft={replyDraft}
            onReplyDraft={setReplyDraft}
            onReplySubmit={() => void submitReply(card.id)}
            busy={busy}
          />
        ))}
      </div>
    </section>
  )
}

function BoardCard(props: {
  anonymous: boolean
  busy: boolean
  // Liking is still allowed; adding words to the wall is not.
  canReact: boolean
  canReply: boolean
  // Nothing on this card may be changed: the teacher is away.
  readOnly?: boolean
  card: BoardPost
  locale: ParticipantLocale
  mine: boolean
  reactions: BoardReaction[]
  replies: BoardPost[]
  viewerId: string
  replying: boolean
  replyDraft: string
  onReact: (emoji: string) => void
  onReply: () => void
  onReplyDraft: (value: string) => void
  onReplySubmit: () => void
  onWithdraw: () => void
  // Correcting a card or a reply. One draft is enough for the whole wall:
  // only one thing can be open for editing at a time.
  editingId: string | null
  editDraft: string
  onEditStart: (post: BoardPost) => void
  onEditDraft: (value: string) => void
  onEditCancel: () => void
  onEditSubmit: (postId: string) => void
}) {
  const { anonymous, busy, canReact, canReply, card, locale, mine, reactions, replies, viewerId, replying, replyDraft } = props
  const { editingId, editDraft } = props
  // Only the words can be corrected. A photograph or a recording is replaced by
  // taking it down and sending another, which is what the buttons already do.
  const editable = mine && !card.deleted_at && !props.readOnly && (card.kind === 'text' || card.kind === 'link')
  // The row appears whenever the board is open to the class: as buttons when
  // reacting is allowed, and as a plain tally when it is not.
  const showReactions = canReact || reactions.length > 0
  // Follows the session's own switch, live, exactly as danmaku does: a
  // presenter who turns anonymity off expects the names to appear, on what is
  // already on the wall as well as on what comes next. The flag stored on each
  // card records what the class was shown at the time, which is what the
  // report reads; it is deliberately not what the screen obeys.
  const author = anonymous && !mine
    ? participantText(locale, 'boardAnonymous')
    : card.participant_name

  return (
    <article className={`board-card${card.deleted_at ? ' is-withdrawn' : ''}${card.pinned_at ? ' is-pinned' : ''}`}>
      <header>
        <strong>{author}</strong>
        {card.deleted_at && <span className="board-card-tag">{participantText(locale, 'boardWithdrawn')}</span>}
        {!card.deleted_at && card.edited_at && (
          <span className="board-card-tag">{participantText(locale, 'boardEdited')}</span>
        )}
      </header>

      {editingId === card.id ? (
        <div className="board-card-editor">
          <textarea
            autoFocus
            maxLength={1000}
            rows={card.kind === 'link' ? 1 : 3}
            value={editDraft}
            onChange={(event) => props.onEditDraft(event.target.value)}
          />
          <div className="board-card-editor-actions">
            <button disabled={busy || !editDraft.trim()} type="button" onClick={() => props.onEditSubmit(card.id)}>
              {participantText(locale, 'boardSave')}
            </button>
            <button className="board-card-action" disabled={busy} type="button" onClick={props.onEditCancel}>
              {participantText(locale, 'boardCancel')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {card.kind === 'text' && <p className="board-card-text">{card.body}</p>}
          {card.kind === 'link' && card.url && (
            <a className="board-card-link" href={card.url} rel="noreferrer noopener" target="_blank">{card.url}</a>
          )}
        </>
      )}
      {isImageCard(card) && card.public_url && (
        <a href={card.public_url} rel="noreferrer noopener" target="_blank">
          <img alt="" className="board-card-image" src={card.public_url} />
        </a>
      )}
      {card.kind === 'file' && card.public_url && (
        // Kept under a picture as well: the name is often the only clue to
        // what a classmate's photograph is of.
        <a className="board-card-file" download href={card.public_url}>
          <Download size={16} />{boardFileName(card)}
        </a>
      )}
      {card.kind === 'audio' && card.public_url && (
        <audio controls preload="none" src={card.public_url} />
      )}

      <footer>
        {showReactions && (
          <div className="board-card-reactions">
            {REACTIONS.map((emoji) => {
              const count = reactions.filter((entry) => entry.emoji === emoji).length
              const own = reactions.some((entry) => entry.emoji === emoji && entry.participant_id === viewerId)
              // Not a button when it is your own card — liking yourself is a
              // vote, not a reaction — nor when the board is read-only. The
              // tally still shows in both cases: seeing that four people
              // liked what you wrote is the whole point, and after class it
              // is most of what there is to come back for.
              if (mine || !canReact) {
                return count > 0
                  ? <span className="board-reaction is-static" key={emoji}>{emoji}<span>{count}</span></span>
                  : null
              }
              return (
                <button
                  className={`board-reaction${own ? ' is-own' : ''}`}
                  key={emoji}
                  type="button"
                  onClick={() => props.onReact(emoji)}
                >
                  {emoji}{count > 0 && <span>{count}</span>}
                </button>
              )
            })}
            {canReply && (
              <button className="board-card-action" type="button" onClick={props.onReply}>
                {participantText(locale, 'boardReply')}
              </button>
            )}
          </div>
        )}
        {editable && editingId !== card.id && (
          <button className="board-card-action" disabled={busy} type="button" onClick={() => props.onEditStart(card)}>
            <Pencil size={14} />{participantText(locale, 'boardEdit')}
          </button>
        )}
        {mine && !card.deleted_at && !props.readOnly && (
          <button className="board-card-action is-danger" disabled={busy} type="button" onClick={props.onWithdraw}>
            <Trash2 size={14} />{participantText(locale, 'boardWithdraw')}
          </button>
        )}
      </footer>

      {replies.length > 0 && (
        <ul className="board-replies">
          {replies.map((reply) => (
            <li key={reply.id}>
              <strong>{anonymous && reply.participant_id !== viewerId
                ? participantText(locale, 'boardAnonymous')
                : reply.participant_name}</strong>
              {editingId === reply.id ? (
                <div className="board-card-editor">
                  <textarea
                    autoFocus
                    maxLength={1000}
                    rows={2}
                    value={editDraft}
                    onChange={(event) => props.onEditDraft(event.target.value)}
                  />
                  <div className="board-card-editor-actions">
                    <button disabled={busy || !editDraft.trim()} type="button" onClick={() => props.onEditSubmit(reply.id)}>
                      {participantText(locale, 'boardSave')}
                    </button>
                    <button className="board-card-action" disabled={busy} type="button" onClick={props.onEditCancel}>
                      {participantText(locale, 'boardCancel')}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {reply.body}
                  {reply.edited_at && (
                    <span className="board-card-tag">{participantText(locale, 'boardEdited')}</span>
                  )}
                  {reply.participant_id === viewerId && !reply.deleted_at && !props.readOnly && (
                    <button
                      className="board-card-action"
                      disabled={busy}
                      type="button"
                      onClick={() => props.onEditStart(reply)}
                    >
                      <Pencil size={13} />{participantText(locale, 'boardEdit')}
                    </button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {replying && (
        <div className="board-reply-composer">
          <input
            placeholder={participantText(locale, 'boardReplyPlaceholder')}
            value={replyDraft}
            onChange={(event) => props.onReplyDraft(event.target.value)}
          />
          <button disabled={busy || !replyDraft.trim()} type="button" onClick={props.onReplySubmit}>
            {participantText(locale, 'boardPost')}
          </button>
        </div>
      )}
    </article>
  )
}

// The board's own recorder rather than the one the spoken questions use.
//
// That one is right for what it does and wrong for this: it counts down a
// preparation timer, allows exactly one submission per question, and transcodes
// to WAV because the marker needs WAV. A board card needs none of those, and
// keeping the browser's own recording instead of transcoding makes the upload
// roughly a tenth of the size — which is what thirty phones on school wifi
// actually care about.
function BoardRecorder({ busy, locale, onRecorded }: {
  busy: boolean
  locale: ParticipantLocale
  onRecorded: (file: File, durationMs: number) => Promise<void>
}) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => {
      const ms = Date.now() - startedAtRef.current
      setElapsed(ms)
      if (ms >= MAX_RECORDING_MS) recorderRef.current?.stop()
    }, 200)
    return () => window.clearInterval(timer)
  }, [recording])

  async function start() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('此瀏覽器不支援錄音，請改用最新版 Chrome、Edge 或 Safari。')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      streamRef.current = stream
      const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = async () => {
        const durationMs = Math.min(MAX_RECORDING_MS, Date.now() - startedAtRef.current)
        setRecording(false)
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        if (durationMs < 500) {
          setError('錄音時間太短。')
          return
        }
        const type = recorder.mimeType || 'audio/webm'
        const extension = type.includes('mp4') ? 'm4a' : 'webm'
        const blob = new Blob(chunksRef.current, { type })
        await onRecorded(new File([blob], `board.${extension}`, { type }), durationMs)
      }
      startedAtRef.current = Date.now()
      setElapsed(0)
      setRecording(true)
      recorder.start(250)
    } catch {
      setError('無法使用麥克風，請確認權限。')
    }
  }

  const seconds = Math.floor(elapsed / 1000)

  return (
    <div className="board-composer-body board-recorder">
      {error && <p className="error">{error}</p>}
      {recording ? (
        <button className="is-recording" type="button" onClick={() => recorderRef.current?.stop()}>
          <Square size={16} />{participantText(locale, 'boardStop')} · {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </button>
      ) : (
        <button disabled={busy} type="button" onClick={() => void start()}>
          <Mic size={16} />{busy ? participantText(locale, 'boardUploading') : participantText(locale, 'boardRecord')}
        </button>
      )}
    </div>
  )
}
