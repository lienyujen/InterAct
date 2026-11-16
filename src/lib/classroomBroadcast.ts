import type { SupabaseClient } from '@supabase/supabase-js'

export const classroomBroadcastTables = new Set([
  'questions', 'screenshots', 'ai_summaries', 'shared_contents', 'session_events', 'participants',
])

export function classroomChanges(client: SupabaseClient, sessionId: string, participantId: string, enabled: boolean) {
  const channel = client.channel(enabled ? `classroom-changes:${sessionId}` : `participant:${sessionId}:${participantId}`)
  if (!enabled) return channel
  const on = channel.on.bind(channel)
  channel.on = ((type: string, filter: Record<string, unknown>, callback: (payload: unknown) => void) => {
    const table = String(filter.table)
    if (type !== 'postgres_changes' || !classroomBroadcastTables.has(table)) {
      return on(type as never, filter as never, callback as never)
    }
    return on('broadcast', { event: `change:${table}` }, async message => {
      const hint = message.payload as Record<string, unknown> | null
      if (!hint || hint.session_id !== sessionId || hint.table !== table || typeof hint.id !== 'string'
        || !['INSERT', 'UPDATE', 'DELETE'].includes(String(hint.eventType))
        || (filter.event !== '*' && filter.event !== hint.eventType)) return
      // Only our profile may cause a read, even if another public-channel
      // client sends a forged hint. Never trust hint fields as authoritative.
      if (table === 'participants' && hint.id !== participantId) return
      if (table === 'session_events' || table === 'participants') {
        if (hint.eventType === 'DELETE') return
        try {
          const { data, error } = await client.from(table).select('*').eq('session_id', sessionId).eq('id', hint.id).maybeSingle()
          if (!error && data) callback({ schema: 'public', table, eventType: hint.eventType, new: data, old: {} })
        } catch { /* Reconnection/heartbeat recovers missed state, not unhandled rejections. */ }
      } else callback({ schema: 'public', table, eventType: hint.eventType })
    })
  }) as typeof channel.on
  return channel
}

// One catch-up for a burst of subscription/online events. The separate session
// lifecycle channel shares this controller so it cannot trigger a second storm.
export function createClassroomReconnect(refresh: (reconnect: boolean) => void, random = Math.random,
  schedule: (run: () => void, delay: number) => ReturnType<typeof setTimeout> = setTimeout,
  cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout) {
  let connected = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  return {
    subscribed() {
      if (stopped || timer !== undefined) return
      const reconnect = connected
      connected = true
      timer = schedule(() => { timer = undefined; if (!stopped) refresh(reconnect) }, reconnect ? 5000 + random() * 10000 : 300 + random() * 1500)
    },
    stop() { stopped = true; if (timer !== undefined) cancel(timer); timer = undefined },
  }
}
