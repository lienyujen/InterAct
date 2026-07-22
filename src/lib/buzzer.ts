import type { BuzzerSessionEvent } from '../types'

export function isBuzzerAccepting(event: BuzzerSessionEvent | null, now = Date.now()) {
  if (!event || event.payload.finalized || event.payload.cancelled || event.payload.accepting !== true) return false
  const expiresAt = event.payload.expires_at ? Date.parse(event.payload.expires_at) : 0
  return Number.isFinite(expiresAt) && expiresAt > now
}

export function isBuzzerPending(event: BuzzerSessionEvent | null, now = Date.now()) {
  if (!event || event.payload.finalized || event.payload.cancelled) return false
  const expiresAt = event.payload.expires_at ? Date.parse(event.payload.expires_at) : 0
  return Number.isFinite(expiresAt) && expiresAt > now
}
