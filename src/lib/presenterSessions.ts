import type { Session } from '../types'
import { listPresenterCredentials, removePresenterToken } from './presenterAuth'
import { requireSupabase } from './supabase'

export type ManagedSession = Pick<Session, 'id' | 'title' | 'code' | 'status' | 'created_at' | 'ended_at'>

async function functionErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const response = (error as Error & { context?: Response }).context
  if (!response) return error.message || fallback
  try {
    const body = await response.clone().json()
    if (typeof body?.message === 'string') return body.message
  } catch {
    // Use the SDK message when the Edge Function response is not JSON.
  }
  return error.message || fallback
}

export async function listManagedSessions() {
  const credentials = listPresenterCredentials()
  if (!credentials.length) return []

  const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
    body: { action: 'list_sessions', credentials },
  })
  if (error) throw new Error(await functionErrorMessage(error, '無法讀取場次清單。'))
  return (data?.sessions || []) as ManagedSession[]
}

export async function endManagedSession(sessionId: string, presenterToken?: string | null) {
  const { error } = await requireSupabase().functions.invoke('presenter-action', {
    body: presenterToken ? { action: 'end_session', sessionId, presenterToken } : { action: 'end_session', sessionId },
  })
  if (error) throw new Error(await functionErrorMessage(error, '無法關閉場次。'))
}

export async function deleteManagedSession(sessionId: string, presenterToken?: string | null) {
  const { error } = await requireSupabase().functions.invoke('presenter-action', {
    body: presenterToken ? { action: 'delete_session', sessionId, presenterToken } : { action: 'delete_session', sessionId },
  })
  if (error) throw new Error(await functionErrorMessage(error, '無法永久移除場次。'))
  removePresenterToken(sessionId)
}
