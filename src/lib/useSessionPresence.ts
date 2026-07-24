import { useEffect, useState } from 'react'
import { isSupabaseConfigured, requireSupabase } from './supabase'
import type { Participant } from '../types'

type PresencePayload = {
  participant_id?: string
  role?: string
}

export function useSessionPresence(sessionId: string, participant: Participant | null = null) {
  const [onlineParticipantIds, setOnlineParticipantIds] = useState<string[]>([])
  const participantId = participant?.id || null

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase.channel(`classroom-presence:${sessionId}`, {
      config: {
        presence: { key: participantId || `presenter-${crypto.randomUUID()}` },
      },
    })

    const syncPresence = () => {
      const state = channel.presenceState() as Record<string, PresencePayload[]>
      const ids = new Set<string>()
      Object.values(state).flat().forEach((presence) => {
        if (presence.role === 'participant' && presence.participant_id) ids.add(presence.participant_id)
      })
      setOnlineParticipantIds([...ids])
    }

    channel
      .on('presence', { event: 'sync' }, syncPresence)
      .on('presence', { event: 'join' }, syncPresence)
      .on('presence', { event: 'leave' }, syncPresence)
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED' && participantId) {
          await channel.track({
            role: 'participant',
            participant_id: participantId,
            online_at: new Date().toISOString(),
          })
        }
      })

    return () => {
      if (participantId) void channel.untrack()
      void supabase.removeChannel(channel)
    }
  }, [participantId, sessionId])

  return onlineParticipantIds
}
