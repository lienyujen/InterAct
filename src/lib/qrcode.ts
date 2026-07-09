export function buildJoinUrl(sessionId: string) {
  const configuredBase = import.meta.env.VITE_PUBLIC_APP_URL as string | undefined
  const base = (configuredBase || `${window.location.origin}${window.location.pathname}`).replace(/\/$/, '')
  return `${base}/#/join/${sessionId}`
}
