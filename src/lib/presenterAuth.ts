const TOKEN_PREFIX = 'interact:presenter-token:'

export function savePresenterToken(sessionId: string, token: string) {
  window.localStorage.setItem(`${TOKEN_PREFIX}${sessionId}`, token)
}

export function getPresenterToken(sessionId: string) {
  return window.localStorage.getItem(`${TOKEN_PREFIX}${sessionId}`)
}
