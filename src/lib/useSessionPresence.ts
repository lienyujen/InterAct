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

export function useSessionPresence(sessionId: string, options: Options): SessionPresence {
  const { role } = options
  const participantId = options.participant?.id || null
  const [onlineParticipantIds, setOnlineParticipantIds] = useState<string[]>([])
  const [presenterOnline, setPresenterOnline] = useState<boolean | null>(null)
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    // Presenter windows get a fresh key each time, because a teacher may have
    // the controls, the roster and the word cloud open at once and each of them
    // counts as the teacher being here.
    const key = role === 'presenter'
      ? `presenter-${crypto.randomUUID()}`
      : participantId || `guest-${crypto.randomUUID()}`
    const channel = supabase.channel(`classroom-presence:${sessionId}`, {
      config: { presence: { key } },
    })

    const clearGrace = () => {
      if (!graceTimer.current) return
      clearTimeout(graceTimer.current)
      graceTimer.current = null
    }

    const syncPresence = () => {
      const state = channel.presenceState() as Record<string, PresencePayload[]>
      const ids = new Set<string>()
      let presenterHere = false
      Object.values(state).flat().forEach((presence) => {
        if (presence.role === 'participant' && presence.participant_id) ids.add(presence.participant_id)
        if (presence.role === 'presenter') presenterHere = true
      })
      setOnlineParticipantIds([...ids])
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
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .subscribe(async (status) => {
        if (status !== 'SUBSCRIBED') {
          // Our own line to the room is down. Report not knowing rather than
          // reporting an empty room, which would blame the teacher for the
          // student's own dropped connection.
          clearGrace()
          setPresenterOnline(null)
          return
        }
        if (role === 'presenter') {
          await channel.track({ role: 'presenter', online_at: new Date().toISOString() })
        } else if (participantId) {
          await channel.track({
            role: 'participant',
            participant_id: participantId,
            online_at: new Date().toISOString(),
          })
        }
      })

    return () => {
      clearGrace()
      void channel.untrack()
      void supabase.removeChannel(channel)
    }
  }, [participantId, role, sessionId])

  return { onlineParticipantIds, presenterOnline }
}
