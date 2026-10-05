import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'

export function matchesRealtimeFilter(filter: Record<string, unknown>, payload: unknown) {
  if (!payload || typeof payload !== 'object') return false
  const change = payload as Record<string, unknown>
  for (const key of ['schema', 'table']) {
    if (filter[key] && filter[key] !== '*' && change[key] !== filter[key]) return false
  }
  if (filter.event && filter.event !== '*' && change.eventType !== filter.event) return false
  const match = typeof filter.filter === 'string' ? filter.filter.match(/^(\w+)=eq\.(.+)$/u) : null
  if (match) {
    const row = (change.eventType === 'DELETE' ? change.old : change.new) as Record<string, unknown> | undefined
    // DELETE may contain only its primary key; still enforce schema and table.
    if (row && match[1] in row && String(row[match[1]]) !== match[2]) return false
    if (change.eventType !== 'DELETE' && (!row || !(match[1] in row))) return false
  }
  return true
}

// SDK fallback bindings without IDs can dispatch '*' across tables on a channel.
export function guardRealtimeTables(client: SupabaseClient) {
  const channel = client.channel.bind(client)
  const guarded = new WeakSet<RealtimeChannel>()
  client.channel = (...args: Parameters<typeof client.channel>) => {
    const next = channel(...args)
    if (guarded.has(next)) return next
    guarded.add(next)
    const on = next.on.bind(next)
    next.on = ((type: string, filter: Record<string, unknown>, callback: (payload: unknown) => void) =>
      on(type as never, filter as never, (type === 'postgres_changes'
        ? (payload: unknown) => { if (matchesRealtimeFilter(filter, payload)) callback(payload) }
        : callback) as never)) as typeof next.on
    return next
  }
  return client
}
