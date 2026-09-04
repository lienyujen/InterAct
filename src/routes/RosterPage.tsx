import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { ArrowDownWideNarrow, Hand, Users, X } from 'lucide-react'
import { getPresenterToken } from '../lib/presenterAuth'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { useSessionPresence } from '../lib/useSessionPresence'
import { buzzerWinsFrom, participationRows } from '../lib/participation'
import type { ParticipationRow } from '../lib/participation'
import type { Answer, FileResponse, Message, Participant, Question, SessionCustomQuizResults, SessionEvent } from '../types'

type SortMode = 'engagement' | 'name' | 'joined'

const sortLabels: Record<SortMode, string> = {
  engagement: '參與積極度',
  name: '姓名',
  joined: '加入順序',
}

function minutes(ms: number) {
  return Math.round(ms / 60_000)
}

// Its own window so the presenter can keep the roster in view while working,
// rather than a panel that covers the controls it sits on.
export function RosterPage() {
  const { sessionId = '' } = useParams()
  const [participants, setParticipants] = useState<Participant[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [answers, setAnswers] = useState<Answer[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [quiz, setQuiz] = useState<SessionCustomQuizResults | null>(null)
  const [uploadMarks, setUploadMarks] = useState<FileResponse[]>([])
  const [events, setEvents] = useState<SessionEvent[]>([])
  const [sort, setSort] = useState<SortMode>('engagement')
  const [calling, setCalling] = useState('')
  const [error, setError] = useState('')
  const onlineParticipantIds = useSessionPresence(sessionId)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const [p, q, a, m, e] = await Promise.all([
      supabase.from('participants').select('*').eq('session_id', sessionId).order('joined_at').limit(5000),
      supabase.from('questions').select('*').eq('session_id', sessionId).order('created_at').limit(500),
      supabase.from('answers').select('*').eq('session_id', sessionId).limit(10000),
      supabase.from('messages').select('*').eq('session_id', sessionId).limit(5000),
      supabase.from('session_events').select('*').eq('session_id', sessionId).eq('event_type', 'buzzer').limit(2000),
    ])
    setParticipants((p.data || []) as Participant[])
    setQuestions((q.data || []) as Question[])
    setAnswers((a.data || []) as Answer[])
    setMessages((m.data || []) as Message[])
    setEvents((e.data || []) as SessionEvent[])

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
    for (const table of ['participants', 'answers', 'messages', 'questions', 'session_events']) {
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
    const online = (row: ParticipationRow) => onlineParticipantIds.includes(row.participant.id)
    const scored = computed.some((row) => row.score > 0)
    return [...computed].sort((a, b) => {
      // Whoever left is no longer actionable, so they sink regardless of sort.
      if (online(a) !== online(b)) return online(a) ? -1 : 1
      if (sort === 'name') return a.participant.name.localeCompare(b.participant.name, 'zh-Hant')
      if (sort === 'joined') return a.participant.joined_at.localeCompare(b.participant.joined_at)
      // Before anyone has done anything the scores are all zero and the order
      // would be arbitrary, so fall back to something stable and readable.
      if (!scored) return a.participant.name.localeCompare(b.participant.name, 'zh-Hant')
      return b.score - a.score
    })
  }, [answers, events, messages, onlineParticipantIds, participants, questions, quiz, sort, uploadMarks])

  const onlineCount = rows.filter((row) => onlineParticipantIds.includes(row.participant.id)).length

  async function callOn(participantId: string, name: string) {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) { setError('這個場次沒有講者操作權限。'); return }
    setCalling(participantId)
    setError('')
    try {
      const { error: callError } = await requireSupabase().functions.invoke('presenter-action', {
        body: { action: 'draw_lottery', sessionId, presenterToken, candidateIds: [participantId] },
      })
      if (callError) throw callError
    } catch {
      setError(`點名「${name}」失敗，請再試一次。`)
    } finally {
      setCalling('')
    }
  }

  function cycleSort() {
    setSort((current) => (current === 'engagement' ? 'name' : current === 'name' ? 'joined' : 'engagement'))
  }

  return (
    <main className="roster-window">
      <header className="roster-heading">
        <h1><Users size={17} />線上名單</h1>
        <button
          aria-label="關閉線上名單"
          className="icon-button ghost-button"
          title="關閉"
          type="button"
          onClick={() => window.interactDesktop?.close()}
        >
          <X size={18} />
        </button>
      </header>

      <div className="roster-toolbar">
        <span className="roster-count">線上 {onlineCount}／共 {rows.length} 人</span>
        <button className="roster-sort" type="button" title="切換排序" onClick={cycleSort}>
          <ArrowDownWideNarrow size={14} />{sortLabels[sort]}
        </button>
      </div>

      {activeQuestion && (
        <p className="roster-hint">派題中：未作答者以橘色標示</p>
      )}
      {error && <p className="error roster-error">{error}</p>}

      {rows.length ? (
        <ol className="roster-list">
          {rows.map((row) => {
            const online = onlineParticipantIds.includes(row.participant.id)
            const pending = Boolean(activeQuestion) && online && !row.answeredQuestionIds.has(activeQuestion?.id || '')
            // Away for a stretch rather than a moment between tabs.
            const distracted = online && row.unfocusedMs >= 2 * 60_000
            const classes = ['roster-row']
            if (!online) classes.push('is-offline')
            if (pending) classes.push('is-pending')
            if (distracted) classes.push('is-distracted')
            return (
              <li className={classes.join(' ')} key={row.participant.id}>
                <span className={`roster-dot${online ? ' is-online' : ''}`} />
                <span className="roster-name">
                  {row.participant.name}
                  {row.badges.length > 0 && (
                    <span className="roster-badges" title={row.badges.map((badge) => `${badge.label}：${badge.detail}`).join('\n')}>
                      {row.badges.map((badge) => <span key={badge.key}>{badge.icon}</span>)}
                    </span>
                  )}
                </span>
                <span className="roster-tags">
                  {pending && <span className="roster-tag is-pending">未作答</span>}
                  {distracted && <span className="roster-tag is-distracted">離開 {minutes(row.unfocusedMs)} 分</span>}
                </span>
                <span
                  className="roster-score"
                  title={[
                    `作答 ${row.answerCount}`,
                    `答對 ${row.correctCount}`,
                    `彈幕 ${row.messageCount}`,
                    `搶答 ${row.quickCount}`,
                    row.uploadScore !== null ? `上傳作答 ${row.uploadScore} 分` : '',
                  ].filter(Boolean).join('．')}
                >
                  {row.score}
                </span>
                <button
                  aria-label={`點名 ${row.participant.name}`}
                  className="roster-call"
                  disabled={!online || calling === row.participant.id}
                  title="點名這位學員"
                  type="button"
                  onClick={() => void callOn(row.participant.id, row.participant.name)}
                >
                  <Hand size={14} />
                </button>
              </li>
            )
          })}
        </ol>
      ) : <p className="muted roster-empty">還沒有學員加入。</p>}
    </main>
  )
}
