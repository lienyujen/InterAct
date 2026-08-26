type DiagnosticDetails = Record<string, string | number | boolean | null | undefined>

export function logDiagnostic(event: string, details: DiagnosticDetails = {}) {
  const payload = {
    event,
    online: navigator.onLine,
    ...details,
  }
  console.warn(`[InterAct] ${event}`, payload)
  void window.interactDesktop?.logDiagnostic(payload).catch(() => {
    // Diagnostics must never interfere with a live class.
  })
}
