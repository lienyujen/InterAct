// What each student is told about their own standing, and how it gets to them.
//
// The number a student sees has to be the number on the teacher's list, or the
// two are worth less than either alone. That list is `participationRows`, which
// needs the whole class — every answer, message, quiz attempt, marked upload
// and board card — and no student may read most of that, nor should 145 devices
// each fetch it: that load is exactly what took the 145-person session down.
//
// So the presenter's own window works it out, once, on the machine that already
// has the authority to read all of it, and broadcasts each student their own
// line. The scoring rule stays in one place, the class does no extra querying,
// and the roster window can stay shut — it is a separate window that is open
// only when the teacher opens it, which is why the calculation cannot live
// there.
//
// The broadcast carries no names. A student can see the shape of the class from
// it, which is what a rank is, but not who anyone is.

import { useCallback, useEffect, useRef, useState } from 'react'
import { buzzerWinsFrom, participationRows } from './participation'
import type { Badge } from './participation'
import { getPresenterToken } from './presenterAuth'
import { requireSupabase } from './supabase'
import type {
  Answer, BoardPost, FileResponse, Message, Participant, ParticipantPoint,
  Question, SessionCustomQuizResults, SessionEvent,
} from '../types'

export type Standing = {
  id: string
  score: number
  rank: number
  classSize: number
  badges: Badge[]
  awayMs: number
}

const CHANNEL = (sessionId: string) => `standings:${sessionId}`
const REFRESH_MS = 30_000

// Runs on the presenter's main window, which is open for the whole class.
export function useStandingsBroadcast(sessionId: string, presenceKey: string) {
  const latest = useRef<Standing[]>([])
  const publishRef = useRef<(() => Promise<void>) | null>(null)

  const compute = useCallback(async (): Promise<Standing[]> => {
    const supabase = requireSupabase()
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) return []

    const [p, q, a, m, e, pt] = await Promise.all([
      supabase.from('participants').select('*').eq('session_id', sessionId).order('joined_at').limit(5000),
      supabase.from('questions').select('*').eq('session_id', sessionId).order('created_at').limit(500),
      supabase.from('answers').select('*').eq('session_id', sessionId).limit(10000),
      supabase.from('messages').select('*').eq('session_id', sessionId).limit(5000),
      supabase.from('session_events').select('*').eq('session_id', sessionId).eq('event_type', 'buzzer').limit(2000),
      supabase.from('participant_points').select('*').eq('session_id', sessionId).limit(5000),
    ])

    // Private to the presenter, so they come back through the action rather
    // than the table. Without them the score would be lower than the roster's
    // for anyone who sat a quiz or handed in a photograph.
    const [quizResult, uploadResult, boardResult] = await Promise.all([
      supabase.functions.invoke('presenter-action', {
        body: { action: 'get_session_custom_quiz_results', sessionId, presenterToken },
      }),
      supabase.functions.invoke('presenter-action', {
        body: { action: 'get_file_responses', sessionId, presenterToken },
      }),
      supabase.functions.invoke('presenter-action', {
        body: { action: 'get_session_board_posts', sessionId, presenterToken },
      }),
    ])

    const participants = ((p.data || []) as Participant[]).filter((entry) => !entry.removed_at)
    const quiz = (quizResult.data || null) as SessionCustomQuizResults | null
    const rows = participationRows({
      participants,
      questions: (q.data || []) as Question[],
      answers: (a.data || []) as Answer[],
      messages: (m.data || []) as Message[],
      quizAttempts: quiz?.attempts || [],
      buzzerWins: buzzerWinsFrom((e.data || []) as SessionEvent[]),
      uploadMarks: (uploadResult.data?.responses || []) as FileResponse[],
      boardPosts: (boardResult.data?.posts || []) as BoardPost[],
      // Null for the same reason the roster passes null: the class is running,
      // so the absence clock runs to now. The two have to agree.
      endedAt: null,
    })

    // The teacher's manual awards are part of the figure on the roster, so they
    // are part of this one too.
    const awarded = new Map<string, number>()
    for (const point of ((pt.data || []) as ParticipantPoint[])) {
      awarded.set(point.participant_id, (awarded.get(point.participant_id) || 0) + point.points)
    }

    const totals = rows.map((row) => ({
      id: row.participant.id,
      score: row.score + (awarded.get(row.participant.id) || 0),
      badges: row.badges,
      awayMs: row.awayMs,
    }))
    // Equal scores share a place, which is what anyone reading "第 3 名"
    // expects when two people are level — and the next place down skips, so
    // the last number still matches the size of the class.
    const ordered = [...totals].sort((left, right) => right.score - left.score)
    let rank = 0
    let previousScore: number | null = null
    return ordered.map((entry, index) => {
      if (previousScore === null || entry.score !== previousScore) {
        rank = index + 1
        previousScore = entry.score
      }
      return { ...entry, rank, classSize: ordered.length }
    })
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const supabase = requireSupabase()
    const channel = supabase.channel(CHANNEL(sessionId))

    const publish = async () => {
      try {
        const rows = await compute()
        if (!rows.length) return
        latest.current = rows
        await channel.send({ type: 'broadcast', event: 'standings', payload: { rows } })
      } catch {
        // A class that cannot be scored still runs. Nothing here is worth
        // interrupting a lesson for.
      }
    }

    publishRef.current = publish

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') void publish()
    })
    const timer = window.setInterval(() => void publish(), REFRESH_MS)

    return () => {
      window.clearInterval(timer)
      publishRef.current = null
      void supabase.removeChannel(channel)
    }
  }, [compute, sessionId])

  // Somebody arrived, left, or reloaded their page, so send again rather than
  // leaving them looking at nothing until the next sweep. A reload drops the
  // student out of presence and puts them back, which is what makes this fire
  // for a refresh and not only for a new joiner.
  //
  // Doing it from this side is what keeps the cost linear: if each new page
  // asked for itself, every request would reach all of the others as well, and
  // a class that starts together would open with a square's worth of messages.
  useEffect(() => {
    if (!presenceKey || !publishRef.current) return
    const timer = window.setTimeout(() => void publishRef.current?.(), 1500)
    return () => window.clearTimeout(timer)
  }, [presenceKey])
}

// Runs on each student's page. One channel, no queries, and nothing arrives
// that is not about this class.
export function useMyStanding(sessionId: string, participantId: string | null) {
  const [standing, setStanding] = useState<Standing | null>(null)

  useEffect(() => {
    if (!sessionId || !participantId) return
    const supabase = requireSupabase()
    const channel = supabase.channel(CHANNEL(sessionId))

    channel.on('broadcast', { event: 'standings' }, (message) => {
      const rows = (message.payload as { rows?: Standing[] } | undefined)?.rows
      if (!Array.isArray(rows)) return
      setStanding(rows.find((row) => row.id === participantId) || null)
    })

    // Listening only. The presenter sends when the class changes size, so a
    // page that has just opened is answered without asking.
    channel.subscribe()

    return () => { void supabase.removeChannel(channel) }
  }, [participantId, sessionId])

  return standing
}
