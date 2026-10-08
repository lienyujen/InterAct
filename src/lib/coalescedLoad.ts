// One pending refresh replaces a burst of refreshes, never parallel read storms.
export function createCoalescedLoader() {
  let running: Promise<void> | null = null
  let pending: {
    load: () => Promise<void>
    promise: Promise<void>
    resolve: () => void
    reject: (error: unknown) => void
  } | null = null

  const start = (load: () => Promise<void>) => {
    const task = Promise.resolve().then(load)
    running = task
    const finish = () => {
      running = null
      const next = pending
      pending = null
      if (next) start(next.load).then(next.resolve, next.reject)
    }
    task.then(finish, finish)
    return task
  }

  return (load: () => Promise<void>) => {
    if (!running) return start(load)
    if (pending) {
      pending.load = load
      return pending.promise
    }
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
    pending = { load, promise, resolve, reject }
    // Awaiting a snapshot does not wait forever for unrelated later events.
    return promise
  }
}
