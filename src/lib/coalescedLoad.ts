// One pending refresh replaces a burst of refreshes, never parallel read storms.
export function createCoalescedLoader() {
  let running: Promise<void> | null = null
  let pending: (() => Promise<void>) | null = null
  return (load: () => Promise<void>) => {
    pending = load
    if (running) return running
    running = (async () => {
      while (pending) {
        const next = pending
        pending = null
        await next()
      }
    })().finally(() => { running = null; pending = null })
    return running
  }
}
