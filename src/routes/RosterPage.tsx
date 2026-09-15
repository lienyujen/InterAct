import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowDownWideNarrow, CircleCheck, ClipboardList, Plus, UserMinus, Users, X } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { RosterManager } from '../components/RosterManager'
import { getPresenterToken } from '../lib/presenterAuth'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { useSessionPresence } from '../lib/useSessionPresence'
import { buzzerWinsFrom, participationRows } from '../lib/participation'
import { getRoster, getSessionRosterId, matchRoster } from '../lib/classRoster'
import type { ClassRoster } from '../lib/classRoster'
import type { ParticipationRow } from '../lib/participation'
import type { Answer, FileResponse, Message, Participant, ParticipantPoint, Question, SessionCustomQuizResults, SessionEvent } from '../types'

type SortMode = 'engagement' | 'name' | 'joined'

const sortLabels: Record<SortMode, string> = {
  engagement: '參與積極度',
  name: '姓名',
  joined: '加入順序',
}

function minutes(ms: number) {
  return Math.round(ms / 60_000)
}

// One line of the window. A class list adds a second kind of line to what used
// to be a straight rendering of the participants table: someone who is on the
// list and has not turned up has no participant row at all, so everything that
// hangs off one has to be optional here.
type RosterRow = {
  key: string
  name: string
  studentNo: string
  unit: string
  // Null for a name on the list that nobody has joined under.
  participation: ParticipationRow | null
  online: boolean
  onRoster: boolean
  points: number
}

// Its own window so the presenter can keep the roster in view while working,
// rather than a panel that covers the controls it sits on.
export function RosterPage() {
  const { sessionId = '' } = useParams()
  const [participants, setParticipants] = useState<Participant[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Answer[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [points, setPoints] = useState<ParticipantPoint[]>([])
  const [quiz, setQuiz] = useState<SessionCustomQuizResults | null>(null)
  const [uploadMarks, setUploadMarks] = useState<FileResponse[]>([])
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [sort, setSort] = useState<SortMode>('engagement')
  const [roster, setRoster] = useState<ClassRoster | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [pendingRemoval, setPendingRemoval] = useState<{ id: string; name: string } | null>(null)
  const [error, setError] = useState('')
  const onlineParticipantIds = useSessionPresence(sessionId)

  // Read from this computer rather than the database; see lib/classRoster.ts.
  const readRoster = useCallback(() => {
    const rosterId = getSessionRosterId(sessionId)
    setRoster(rosterId ? getRoster(rosterId) : null)
  }, [sessionId])

  useEffect(() => { readRoster() }, [readRoster])

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const [p, q, a, m, e, pt] = await Promise.all([
      supabase.from('participants').select('*').eq('session_id', sessionId).order('joined_at').limit(5000),
      supabase.from('questions').select('*').eq('session_id', sessionId).order('created_at').limit(500),
      supabase.from('answers').select('*').eq('session_id', sessionId).limit(10000),
      supabase.from('messages').select('*').eq('session_id', sessionId).limit(5000),
      supabase.from('session_events').select('*').eq('session_id', sessionId).eq('event_type', 'buzzer').limit(2000),
      supabase.from('participant_points').select('*').eq('session_id', sessionId).limit(5000),
    ])
    // Someone the presenter removed keeps their row, because everything they
    // answered hangs off it, but they are no longer in the class.
    setParticipants(((p.data || []) as Participant[]).filter((entry) => !entry.removed_at))
    setQuestions((q.data || []) as Question[])
    setAnswers((a.data || []) as Answer[])
    setMessages((m.data || []) as Message[])
    setEvents((e.data || []) as SessionEvent[])
    setPoints((pt.data || []) as ParticipantPoint[])

    // Quiz attempts and marked uploads only come back through the presenter
    // action — file_responses is private to the presenter — and the score
    // would be wrong without them.
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) return
    const [quizResult, uploadResult] = await Promise.all([
      supabase.functions.invoke('presenter-action', {
        body: { action: 'get_session_custom_quiz_results', sessionId, presenterToken },
      }),
      supabase.functions.invoke('presenter-action', {
        body: { action: 'get_file_responses', sessionId, presenterToken },
      }),
    ])
    if (quizResult.data) setQuiz(quizResult.data as SessionCustomQuizResults)
    setUploadMarks((uploadResult.data?.responses || []) as FileResponse[])
  }, [sessionId])

  useEffect(() => {
    void load()
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase.channel(`roster:${sessionId}`)
    for (const table of ['participants', 'answers', 'messages', 'questions', 'session_events', 'participant_points']) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, filter: `session_id=eq.${sessionId}` }, () => void load())
    }
    channel.subscribe()
    // Attention is reported on a heartbeat rather than as a row change, so the
    // figures need a nudge to stay current.
    const timer = window.setInterval(() => void load(), 20_000)
    return () => {
      window.clearInterval(timer)
      void supabase.removeChannel(channel)
    }
  }, [load, sessionId])

  const activeQuestion = useMemo(
    () => questions.find((question) => question.status === 'active') || null,
    [questions],
  )

  const pointsByParticipant = useMemo(() => {
    const totals = new Map<string, number>()
    for (const award of points) {
      totals.set(award.participant_id, (totals.get(award.participant_id) || 0) + award.points)
    }
    return totals
  }, [points])

  const rows = useMemo(() => {
    const computed = participationRows({
      participants,
      questions,
      answers,
      messages,
      quizAttempts: quiz?.attempts || [],
      buzzerWins: buzzerWinsFrom(events),
      uploadMarks,
    })
    const byParticipantId = new Map(computed.map((row) => [row.participant.id, row]))
    const online = (participantId: string | null) => Boolean(participantId) && onlineParticipantIds.includes(participantId as string)

    const toRow = (
      participation: ParticipationRow | null,
      name: string,
      studentNo: string,
      unit: string,
      onRoster: boolean,
      key: string,
    ): RosterRow => ({
      key,
      name,
      studentNo,
      unit,
      participation,
      online: online(participation?.participant.id || null),
      onRoster,
      points: participation ? pointsByParticipant.get(participation.participant.id) || 0 : 0,
    })

    if (!roster) {
      return computed.map((row) => toRow(row, row.participant.name, '', '', false, row.participant.id))
    }

    const { matches, matchedParticipantIds } = matchRoster(roster.entries, participants)
    // The class list first, in the order the presenter put it in, so a teacher
    // reading down it is reading their own list. The name shown is the one on
    // the list, not the one the student typed — that is the whole point of
    // matching, and the two differ by exactly the spacing being ignored.
    const listed = matches.map(({ entry, participantId }) => toRow(
      participantId ? byParticipantId.get(participantId) || null : null,
      entry.name,
      entry.studentNo,
      entry.unit,
      true,
      entry.id,
    ))
    // Whoever typed something that is not on the list still joined, under what
    // they typed. They are not an error, just not identified.
    const unlisted = computed
      .filter((row) => !matchedParticipantIds.has(row.participant.id))
      .map((row) => toRow(row, row.participant.name, '', '', false, row.participant.id))

    return [...listed, ...unlisted]
  }, [answers, events, messages, onlineParticipantIds, participants, pointsByParticipant, questions, quiz, roster, uploadMarks])

  const sortedRows = useMemo(() => {
    const scored = rows.some((row) => (row.participation?.score || 0) > 0)
    return [...rows].sort((a, b) => {
      // Whoever is not here is not actionable, so they sink regardless of sort —
      // and someone on the list who never turned up sinks furthest.
      if (a.online !== b.online) return a.online ? -1 : 1
      if (Boolean(a.participation) !== Boolean(b.participation)) return a.participation ? -1 : 1
      if (sort === 'name') return a.name.localeCompare(b.name, 'zh-Hant')
      if (sort === 'joined') {
        const left = a.participation?.participant.joined_at || ''
        const right = b.participation?.participant.joined_at || ''
        return left.localeCompare(right)
      }
      // Before anyone has done anything the scores are all zero and the order
      // would be arbitrary, so fall back to something stable and readable.
      if (!scored) return a.name.localeCompare(b.name, 'zh-Hant')
      return (b.participation?.score || 0) - (a.participation?.score || 0)
    })
  }, [rows, sort])

  const onlineCount = sortedRows.filter((row) => row.online).length
  const joinedCount = participants.length

  async function callPresenter(body: Record<string, unknown>, failure: string) {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) { setError('這個場次沒有講者操作權限。'); return false }
    try {
      const { data, error: callError } = await requireSupabase().functions.invoke('presenter-action', {
        body: { ...body, sessionId, presenterToken },
      })
      if (callError) throw callError
      if (data?.message && !data?.ok && !data?.point) throw new Error(data.message)
      setError('')
      return true
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : failure)
      return false
    }
  }

  async function award(participantId: string) {
    setBusyId(participantId)
    if (await callPresenter({ action: 'award_participant_point', participantId, points: 1 }, '加分失敗，請再試一次。')) {
      await load()
    }
    setBusyId('')
  }

  async function revoke(participantId: string) {
    setBusyId(participantId)
    if (await callPresenter({ action: 'revoke_participant_point', participantId }, '取消加分失敗。')) {
      await load()
    }
    setBusyId('')
  }

  async function removeParticipant() {
    if (!pendingRemoval) return
    const { id } = pendingRemoval
    setBusyId(id)
    if (await callPresenter({ action: 'remove_participant', participantId: id }, '移除失敗，請再試一次。')) {
      await load()
    }
    setBusyId('')
    setPendingRemoval(null)
  }

  function cycleSort() {
    setSort((current) => (current === 'engagement' ? 'name' : current === 'name' ? 'joined' : 'engagement'))
  }

  return (
    <main className="roster-window">
      <header className="roster-heading">
        <h1><Users size={17} />線上名單</h1>
        <span className="roster-heading-actions">
          <button
            aria-label="匯入與編輯學員名單"
            className="icon-button ghost-button"
            title="匯入與編輯名單"
            type="button"
            onClick={() => setManagerOpen(true)}
          >
            <ClipboardList size={18} />
          </button>
          <button
            aria-label="關閉線上名單"
            className="icon-button ghost-button"
            title="關閉"
            type="button"
            onClick={() => window.interactDesktop?.close()}
          >
            <X size={18} />
          </button>
        </span>
      </header>

      <div className="roster-toolbar">
        <span className="roster-count">
          線上 {onlineCount}／已加入 {joinedCount}
          {roster ? `／名單 ${roster.entries.length} 人` : ' 人'}
        </span>
        <button className="roster-sort" type="button" title="切換排序" onClick={cycleSort}>
          <ArrowDownWideNarrow size={14} />{sortLabels[sort]}
        </button>
      </div>

      {activeQuestion && (
        <p className="roster-hint">派題中：未作答者以橘色標示</p>
      )}
      {error && <p className="error roster-error">{error}</p>}

      {sortedRows.length ? (
        <ol className="roster-list">
          {sortedRows.map((row) => {
            const participation = row.participation
            const pending = Boolean(activeQuestion) && row.online
              && !participation?.answeredQuestionIds.has(activeQuestion?.id || '')
            // Away for a stretch rather than a moment between tabs.
            const distracted = row.online && (participation?.unfocusedMs || 0) >= 2 * 60_000
            const classes = ['roster-row']
            if (!participation) classes.push('is-absent')
            else if (!row.online) classes.push('is-offline')
            if (pending) classes.push('is-pending')
            if (distracted) classes.push('is-distracted')
            const busy = busyId === participation?.participant.id
            return (
              <li className={classes.join(' ')} key={row.key}>
                <span className={`roster-dot${row.online ? ' is-online' : ''}`} />
                <span className="roster-name">
                  {row.name}
                  {/* A green tick means this line on the class list was claimed by
                      somebody who actually joined — the one thing a teacher is
                      scanning for when they take attendance. */}
                  {row.onRoster && participation && (
                    <CircleCheck aria-label="已加入" className="roster-present" size={14} />
                  )}
                  {participation && participation.badges.length > 0 && (
                    <span className="roster-badges" title={participation.badges.map((badge) => `${badge.label}：${badge.detail}`).join('\n')}>
                      {participation.badges.map((badge) => <span key={badge.key}>{badge.icon}</span>)}
                    </span>
                  )}
                </span>
                <span className="roster-tags">
                  {row.studentNo && <span className="roster-tag is-quiet">{row.studentNo}</span>}
                  {!row.onRoster && roster && <span className="roster-tag is-unlisted">不在名單</span>}
                  {!participation && <span className="roster-tag is-absent">未到</span>}
                  {pending && <span className="roster-tag is-pending">未作答</span>}
                  {distracted && <span className="roster-tag is-distracted">離開 {minutes(participation?.unfocusedMs || 0)} 分</span>}
                </span>

                {/* Nothing below this point applies to a name nobody has joined
                    under: there is no participant to score, credit or remove. */}
                {participation && (
                  <>
                    {/* One number, because pressing + has to move the number the
                        presenter is looking at. The split that matters — earned
                        against awarded — is kept where it can be audited: its own
                        columns in the exported report. */}
                    <span
                      className="roster-score"
                      title={[
                        `作答 ${participation.answerCount}`,
                        `答對 ${participation.correctCount}`,
                        `彈幕 ${participation.messageCount}`,
                        `搶答 ${participation.quickCount}`,
                        participation.uploadScore !== null ? `上傳作答 ${participation.uploadScore} 分` : '',
                        row.points > 0 ? `老師加分 +${row.points}` : '',
                      ].filter(Boolean).join('．')}
                    >
                      {participation.score + row.points}
                    </span>
                    {row.points > 0 && (
                      <button
                        className="roster-bonus"
                        disabled={busy}
                        title={`其中 ${row.points} 分是老師加的。點一下取消最後一次加分`}
                        type="button"
                        onClick={() => void revoke(participation.participant.id)}
                      >
                        +{row.points}
                      </button>
                    )}
                    <button
                      aria-label={`給 ${row.name} 加一分`}
                      className="roster-award"
                      disabled={busy}
                      title="加一分"
                      type="button"
                      onClick={() => void award(participation.participant.id)}
                    >
                      <Plus size={14} />
                    </button>
                    <button
                      aria-label={`把 ${row.name} 移出名單`}
                      className="roster-remove"
                      disabled={busy}
                      title="移出名單，讓他重新輸入姓名加入"
                      type="button"
                      onClick={() => setPendingRemoval({ id: participation.participant.id, name: row.name })}
                    >
                      <UserMinus size={14} />
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ol>
      ) : <p className="muted roster-empty">還沒有學員加入。</p>}

      <RosterManager
        open={managerOpen}
        sessionId={sessionId}
        onChanged={readRoster}
        onClose={() => { setManagerOpen(false); readRoster() }}
      />

      <ConfirmDialog
        busy={Boolean(busyId)}
        confirmLabel="移出名單"
        description={`「${pendingRemoval?.name || ''}」會離開這個場次，之後要重新輸入姓名才能加入。他已經送出的作答與訊息都會保留，也仍然會出現在課後報表裡。`}
        open={Boolean(pendingRemoval)}
        title="要把這位學員移出名單嗎？"
        onCancel={() => setPendingRemoval(null)}
        onConfirm={() => void removeParticipant()}
      />
    </main>
  )
}
