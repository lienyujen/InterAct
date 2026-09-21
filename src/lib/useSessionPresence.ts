import { useEffect, useRef, useState } from 'react'
import { isSupabaseConfigured, requireSupabase } from './supabase'
import type { Participant } from '../types'

type PresencePayload = {
  participant_id?: string
  role?: string
}

type Options = {
  // Who this client is in the room. Presenter windows announce themselves so
  // the class can tell a teacher who has stepped away from one who is there.
  role: 'presenter' | 'participant'
  participant?: Participant | null
}

export type SessionPresence = {
  onlineParticipantIds: string[]
  // null while nobody has told us yet. A page that has only just opened must not
  // accuse the teacher of being absent before it has finished looking, and the
  // same goes for a client whose own connection has dropped — it knows nothing
  // about the room at that point, which is not the same as knowing the room is
  // empty.
  presenterOnline: boolean | null
}

// How long a presenter may be missing before the class is told. A laptop lid, a
// wifi handover between rooms and a window being restored all drop the socket
// for a few seconds, and announcing the end of class for each of those would be
// worse than saying nothing at all. A real absence is still reported well
// inside half a minute.
const PRESENTER_GRACE_MS = 15_000

// Two channels rather than one, because the two directions are wildly
// different sizes.
//
// Everyone used to sit on one channel and receive everyone else's presence.
// Realtime broadcasts the whole state to every member on every join and leave,
// so a room of 145 cost 145 messages of 145 entries each time one phone woke
// up — and the students were paying for all of it to learn one bit: whether
// the teacher is here. They never read the class list; only the presenter's
// own windows do.
//
// So the class list and the teacher's flag live apart. Students publish to the
// first and read the second; presenters do the opposite. `enabled: false` is
// what makes publishing without receiving possible — track() still makes a
// client visible to whoever is listening. Note that attaching any `presence`
// listener turns receiving back on by itself, so the tracking side must not
// have one.
const CLASS_CHANNEL = (sessionId: string) => `classroom-presence:${sessionId}`
const TEACHER_CHANNEL = (sessionId: string) => `teacher-presence:${sessionId}`

export function useSessionPresence(sessionId: string, options: Options): SessionPresence {
  const { role } = options
  const participantId = options.participant?.id || null
  const [onlineParticipantIds, setOnlineParticipantIds] = useState<string[]>([])
  const [presenterOnline, setPresenterOnline] = useState<boolean | null>(null)
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Who is in the room. Read by the presenter's windows; written by everyone.
  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    if (role === 'participant' && !participantId) return
    const supabase = requireSupabase()
    // Presenter windows get a fresh key each time, because a teacher may have
    // the controls, the roster and the word cloud open at once and each of them
    // counts as the teacher being here.
    const key = role === 'presenter'
      ? `presenter-${crypto.randomUUID()}`
      : participantId as string
    const channel = supabase.channel(CLASS_CHANNEL(sessionId), {
      config: { presence: { key, enabled: role === 'presenter' } },
    })

    if (role === 'presenter') {
      const syncClass = () => {
        const state = channel.presenceState() as Record<string, PresencePayload[]>
        const ids = new Set<string>()
        Object.values(state).flat().forEach((presence) => {
          if (presence.role === 'participant' && presence.participant_id) ids.add(presence.participant_id)
        })
        // A new array on every sync re-rendered whoever is listening, and on the
        // presenter that re-render recomputes participation for the whole class.
        setOnlineParticipantIds((current) => (
          current.length === ids.size && current.every((id) => ids.has(id))
            ? current
            : [...ids]
        ))
      }
      channel
        .on('presence', { event: 'sync' }, syncClass)
        .on('presence', { event: 'join' }, syncClass)
        .on('presence', { event: 'leave' }, syncClass)
    }

    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return
      if (role === 'participant') {
        await channel.track({
          role: 'participant',
          participant_id: participantId,
          online_at: new Date().toISOString(),
        })
      }
    })

    return () => {
      void channel.untrack()
      void supabase.removeChannel(channel)
    }
  }, [participantId, role, sessionId])

  // Whether the teacher is here. Written by the presenter's windows, read by
  // the class — a handful of entries however big the class is.
  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const key = `${role}-${crypto.randomUUID()}`
    const channel = supabase.channel(TEACHER_CHANNEL(sessionId), {
      config: { presence: { key, enabled: role === 'participant' } },
    })

    const clearGrace = () => {
      if (!graceTimer.current) return
      clearTimeout(graceTimer.current)
      graceTimer.current = null
    }

    if (role === 'participant') {
      const syncTeacher = () => {
        const state = channel.presenceState() as Record<string, PresencePayload[]>
        const presenterHere = Object.values(state).flat().some((presence) => presence.role === 'presenter')
        if (presenterHere) {
          clearGrace()
          setPresenterOnline(true)
          return
        }
        // Gone, as far as this sync knows. Wait it out before saying so, and let
        // any sync in the meantime call it off.
        if (graceTimer.current) return
        graceTimer.current = setTimeout(() => {
          graceTimer.current = null
          setPresenterOnline(false)
        }, PRESENTER_GRACE_MS)
      }
      channel
        .on('presence', { event: 'sync' }, syncTeacher)
        .on('presence', { event: 'join' }, syncTeacher)
        .on('presence', { event: 'leave' }, syncTeacher)
    }

    channel.subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') {
        // Our own line to the room is down. Report not knowing rather than
        // reporting an empty room, which would blame the teacher for the
        // student's own dropped connection.
        if (role === 'participant') {
          clearGrace()
          setPresenterOnline(null)
        }
        return
      }
      if (role === 'presenter') {
        await channel.track({ role: 'presenter', online_at: new Date().toISOString() })
      }
    })

    return () => {
      clearGrace()
      void channel.untrack()
      void supabase.removeChannel(channel)
    }
  }, [role, sessionId])

  return { onlineParticipantIds, presenterOnline }
}
