import { getOwnerKey } from './ownerKey'

const TOKEN_PREFIX = 'interact:presenter-token:'

export type PresenterCredential = {
  sessionId: string
  presenterToken: string
}

export function savePresenterToken(sessionId: string, token: string) {
  window.localStorage.setItem(`${TOKEN_PREFIX}${sessionId}`, token)
}

export function getPresenterToken(sessionId: string) {
  return window.localStorage.getItem(`${TOKEN_PREFIX}${sessionId}`)
}

// This is only a local presence check. The Edge Function verifies either
// credential against its own project before returning data or spending on AI.
export function getReportCredentials(sessionId: string) {
  const presenterToken = getPresenterToken(sessionId)
  const ownerKey = getOwnerKey()
  if (!presenterToken && !ownerKey) {
    throw new Error('缺少這個場次的講者憑證或管理金鑰。請到系統設定貼上此專案的管理金鑰。')
  }
  return { sessionId, ...(presenterToken ? { presenterToken } : {}), ...(ownerKey ? { ownerKey } : {}) }
}

export function removePresenterToken(sessionId: string) {
  window.localStorage.removeItem(`${TOKEN_PREFIX}${sessionId}`)
}

export function listPresenterCredentials() {
  const credentials: PresenterCredential[] = []
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (!key?.startsWith(TOKEN_PREFIX)) continue
    const presenterToken = window.localStorage.getItem(key)
    const sessionId = key.slice(TOKEN_PREFIX.length)
    if (sessionId && presenterToken) credentials.push({ sessionId, presenterToken })
  }
  return credentials
}
