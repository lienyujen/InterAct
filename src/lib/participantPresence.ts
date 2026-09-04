import { requireSupabase } from './supabase'

// Reports that a student is still here, and how long the page spent in the
// background. Without this last_seen_at keeps the value it was given at join,
// which made the report's "last activity" column a copy of the join time.
const HEARTBEAT_MS = 30_000

type Args = {
  sessionId: string
  participantId: string
  participantToken: string
}

export function trackParticipantPresence({ sessionId, participantId, participantToken }: Args) {
  let hiddenSince = document.visibilityState === 'hidden' ? Date.now() : 0
  let unreportedMs = 0
  let stopped = false
  // Restarts whenever they leave, so it measures one unbroken stretch of
  // attention rather than the total time they happened to be present.
  let focusedSince = document.visibilityState === 'visible' ? Date.now() : 0

  const settle = () => {
    if (!hiddenSince) return
    unreportedMs += Date.now() - hiddenSince
    hiddenSince = 0
  }

  const send = async (keepalive = false) => {
    settle()
    const unfocusedMs = unreportedMs
    unreportedMs = 0
    const focusStreakMs = focusedSince ? Date.now() - focusedSince : 0
    try {
      const { error } = await requireSupabase().functions.invoke('participant-action', {
        body: { action: 'heartbeat', sessionId, participantId, participantToken, unfocusedMs, focusStreakMs },
        ...(keepalive ? { headers: { 'keep-alive': 'true' } } : {}),
      })
      // Put it back rather than lose it, so a dropped beat does not understate
      // how long the student was away.
      if (error) unreportedMs += unfocusedMs
    } catch {
      unreportedMs += unfocusedMs
    }
    if (document.visibilityState === 'hidden' && !hiddenSince) hiddenSince = Date.now()
  }

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (!hiddenSince) hiddenSince = Date.now()
      focusedSince = 0
      return
    }
    settle()
    focusedSince = Date.now()
    // Report as soon as they come back, so a long absence is not held until the
    // next beat — or lost entirely if they close the tab first.
    void send()
  }

  const timer = window.setInterval(() => { if (!stopped) void send() }, HEARTBEAT_MS)
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('pagehide', () => void send(true))
  void send()

  return () => {
    stopped = true
    window.clearInterval(timer)
    document.removeEventListener('visibilitychange', onVisibility)
    void send(true)
  }
}
