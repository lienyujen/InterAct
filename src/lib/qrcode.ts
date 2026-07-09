export function buildJoinUrl(sessionId: string) {
  const base = `${window.location.origin}${window.location.pathname}`
  return `${base}#/join/${sessionId}`
}
