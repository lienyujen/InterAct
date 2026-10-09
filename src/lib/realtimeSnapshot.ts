type Row = { id: string; [key: string]: unknown }
export type RowChange = { eventType: string; new: Record<string, unknown>; old: Record<string, unknown> }

// Keep changes received during an HTTP snapshot: an older response must never
// undo a hand being lowered, a new answer, or a point being removed.
export function createRealtimeSnapshot() {
  const tables = new Map<string, Map<string, Row>>()
  let journal: Array<{ table: string; change: RowChange }> | null = null
  const apply = (table: string, change: RowChange) => {
    const row = (change.eventType === 'DELETE' ? change.old : change.new) as Row
    if (!row?.id) return
    if (!tables.has(table)) tables.set(table, new Map())
    const rows = tables.get(table)!
    if (change.eventType === 'DELETE') rows.delete(row.id)
    else rows.set(row.id, { ...rows.get(row.id), ...row })
  }
  return {
    begin() { journal = [] },
    abort() { journal = null },
    update(table: string, change: RowChange) {
      if (journal) journal.push({ table, change })
      apply(table, change)
    },
    replace(snapshot: Record<string, Array<{ id: string }>>) {
      for (const [table, rows] of Object.entries(snapshot)) {
        tables.set(table, new Map(rows.map(row => [row.id, row as Row])))
      }
      const replay = journal
      journal = null
      for (const item of replay || []) apply(item.table, item.change)
    },
    rows<T>(table: string): T[] { return [...(tables.get(table)?.values() || [])] as T[] },
  }
}

// Fixed batching window, not trailing debounce: a busy class cannot postpone
// its update forever. Only one asynchronous refresh runs at a time.
export function createBatchedRefresh(refresh: () => Promise<void>, delay = 350, minimumGap = 1000) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let pending = false
  let stopped = false
  let lastStarted = -Infinity
  const request = () => {
    if (stopped) return
    pending = true
    if (timer !== null || running) return
    timer = setTimeout(async () => {
      timer = null
      if (stopped) return
      pending = false
      running = true
      lastStarted = Date.now()
      try { await refresh() } finally {
        running = false
        if (pending) request()
      }
    }, Math.max(delay, minimumGap - (Date.now() - lastStarted)))
  }
  return { request, stop() { stopped = true; pending = false; if (timer !== null) clearTimeout(timer); timer = null } }
}

export function createRevisionGuard() {
  let revision = 0
  return { current: () => revision, changed: () => { revision++ }, accepts: (started: number) => started === revision }
}
