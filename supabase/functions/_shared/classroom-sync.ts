import type { getAdminClient } from './supabase.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

// A second delivery path for a dropped row event, not an authority to change
// state. Receivers read their own row; no names, tokens or scores are sent.
function notify(supabase: ReturnType<typeof getAdminClient>, sessionId: string, event: string, payload: Record<string, unknown>) {
  const channel = supabase.channel(`standings:${sessionId}`)
  const task = channel.httpSend(event, payload)
    .catch(() => { console.warn('Classroom synchronization notification unavailable') })
    .finally(() => supabase.removeChannel(channel))
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(task)
  // Outside the Edge runtime the caught task is still safe to run to completion.
}

export function notifyHandsLowered(supabase: ReturnType<typeof getAdminClient>, sessionId: string, participantId: string) {
  notify(supabase, sessionId, 'hands_lowered', { participantId })
}

export function notifyQuizScoreChanged(supabase: ReturnType<typeof getAdminClient>, sessionId: string) {
  notify(supabase, sessionId, 'score_sources_changed', { source: 'quiz' })
}
