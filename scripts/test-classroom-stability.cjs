const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')

function load(file, globals = {}) {
  const code = ts.transpile(fs.readFileSync(file, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
  const context = { exports: {}, require, ...globals }
  vm.runInNewContext(code, context)
  return context.exports
}

async function main() {
  const { matchesRealtimeFilter, guardRealtimeTables } = load('src/lib/realtimeGuard.ts')
  const filter = { event: '*', schema: 'public', table: 'participants', filter: 'session_id=eq.class' }
  const participant = { eventType: 'INSERT', schema: 'public', table: 'participants', new: { id: 'p', session_id: 'class' } }
  assert.equal(matchesRealtimeFilter(filter, participant), true)
  for (const table of ['questions', 'sessions', 'screenshots', 'answers']) {
    assert.equal(matchesRealtimeFilter(filter, { ...participant, table }), false)
  }
  assert.equal(matchesRealtimeFilter(filter, { ...participant, schema: 'private' }), false)
  assert.equal(matchesRealtimeFilter(filter, { ...participant, new: { session_id: 'other' } }), false)
  assert.equal(matchesRealtimeFilter(filter, { ...participant, new: {} }), false)
  assert.equal(matchesRealtimeFilter(filter, { ...participant, eventType: 'DELETE', old: { id: 'p' } }), true)
  assert.equal(matchesRealtimeFilter({ ...filter, event: 'UPDATE' }, participant), false)
  // Actual installed SDK, no subscribe/network: legacy bindings lack IDs.
  const client = guardRealtimeTables(createClient('https://abcdefghijklmnopqrst.supabase.co', 'sb_publishable_offline_test', { auth: { persistSession: false, autoRefreshToken: false } }))
  let accepted = 0
  let broadcast = 0
  const channel = client.channel('offline').on('postgres_changes', filter, () => accepted++)
    .on('broadcast', { event: 'audio' }, () => broadcast++)
  channel.bindings.postgres_changes[0].callback({ ...participant, table: 'questions' })
  channel.bindings.postgres_changes[0].callback(participant)
  channel.bindings.broadcast[0].callback({ payload: new Uint8Array([1, 2]) })
  assert.equal(accepted, 1)
  assert.equal(broadcast, 1, 'audio broadcasts must pass unchanged')

  const events = () => {
    const listeners = new Map()
    return {
      addEventListener: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn) },
      removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
      fire: name => { for (const fn of listeners.get(name) || []) fn() },
      count: name => listeners.get(name)?.size || 0,
    }
  }
  const document = { visibilityState: 'visible', ...events() }
  let interval
  let calls = 0
  let concurrent = 0
  let maximum = 0
  const resolves = []
  const options = []
  const window = { ...events(), setInterval: fn => { interval = fn; return 1 }, clearInterval: () => { interval = null } }
  const { trackParticipantPresence } = load('src/lib/participantPresence.ts', {
    document, window, Date,
    require: () => ({ requireSupabase: () => ({ functions: { invoke: (_name, option) => {
      calls++; concurrent++; maximum = Math.max(maximum, concurrent); options.push(option)
      return new Promise(resolve => resolves.push(result => { concurrent--; resolve(result) }))
    } } }) }),
  })
  const flush = async () => { await Promise.resolve(); await Promise.resolve() }
  const cleanup = trackParticipantPresence({ sessionId: 'class', participantId: 'p', participantToken: 'token' })
  interval(); interval(); interval()
  assert.equal(calls, 1, 'slow beats must not overlap')
  assert.equal(options[0].timeout, 10000)
  resolves.shift()({ error: null }); await flush()
  document.visibilityState = 'hidden'; document.fire('visibilitychange')
  interval(); interval()
  assert.equal(calls, 1, 'background must stop heartbeat polling')
  document.visibilityState = 'visible'; document.fire('visibilitychange')
  assert.equal(calls, 2, 'returning to the page reports presence')
  cleanup()
  assert.equal(window.count('pagehide'), 0)
  assert.equal(document.count('visibilitychange'), 0)
  assert.equal(interval, null)
  resolves.shift()({ error: null }); await flush()
  assert.equal(calls, 3, 'cleanup queues only one final serialized heartbeat')
  resolves.shift()({ error: null }); await flush()
  window.fire('pagehide')
  assert.equal(calls, 3, 'removed listener cannot send again')
  assert.equal(maximum, 1)

  const { createCoalescedLoader } = load('src/lib/coalescedLoad.ts')
  const refresh = createCoalescedLoader()
  let release
  const seen = []
  const first = refresh(async () => { seen.push('first'); await new Promise(resolve => { release = resolve }) })
  for (let i = 0; i < 100; i++) refresh(async () => { seen.push(i) })
  assert.deepEqual(seen, ['first'])
  release(); await first
  assert.deepEqual(seen, ['first', 99], '100 queued reloads collapse to the latest')
  await refresh(async () => { seen.push('next') })
  assert.equal(seen.at(-1), 'next')

  let abortRead
  let cleared = 0
  let forwarded
  const { boundedFetch } = load('src/lib/boundedFetch.ts', {
    Request, AbortController,
    setTimeout: (fn, ms) => { assert.equal(ms, 20000); abortRead = fn; return 1 },
    clearTimeout: () => { cleared++ },
    fetch: async (_input, init) => {
      forwarded = init
      if (!init?.signal) return { ok: true }
      return new Promise((resolve, reject) => {
        if (init.signal.aborted) reject(new Error('aborted'))
        else init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      })
    },
  })
  const read = boundedFetch('https://example.com/rest/v1/sessions', { headers: { apikey: 'public' } })
  abortRead()
  await assert.rejects(read, /aborted/)
  assert.equal(cleared, 1)
  assert.equal(forwarded.headers.apikey, 'public')
  const caller = new AbortController()
  const cancelled = boundedFetch('https://example.com/rest/v1/sessions', { signal: caller.signal })
  caller.abort()
  await assert.rejects(cancelled, /aborted/)
  assert.equal(cleared, 2)
  await boundedFetch('https://example.com/functions/v1/ai', { method: 'POST' })
  assert.equal(forwarded.signal, undefined, 'AI requests keep their independent timeout')

  // Exercise the exact closure used by the presenter, without React or API calls.
  const source = fs.readFileSync('src/routes/PresenterPage.tsx', 'utf8')
  const closeSource = source.slice(source.indexOf('  async function closeSessionAndApp()'), source.indexOf('  function selectQuestion('))
  for (const mode of ['success', 'failure', 'timeout', 'no-token']) {
    let closed = 0
    let deadline
    let ended = 0
    const context = {
      getPresenterToken: () => mode === 'no-token' ? null : 'token', sessionId: 'class',
      setClosingSession: () => {}, setAnalysisError: () => {}, logDiagnostic: () => {},
      captionConnectionsRef: { current: [] }, stopCourseRecording: async () => {},
      endManagedSession: async () => { ended++; if (mode === 'failure') throw new Error('offline'); if (mode === 'timeout') await new Promise(() => {}) },
      window: { setTimeout: (fn, ms) => { assert.equal(ms, 4000); deadline = fn }, interactDesktop: { close: async () => { closed++ } } },
    }
    vm.createContext(context); vm.runInContext(ts.transpile(closeSource, { target: ts.ScriptTarget.ES2022 }), context)
    const closing = context.closeSessionAndApp()
    await flush()
    if (mode === 'timeout') deadline()
    await closing
    assert.equal(closed, 1, `must close locally during ${mode}`)
    assert.equal(ended, mode === 'no-token' ? 0 : 1)
  }
  console.log('PASS: table isolation, unchanged audio broadcast, serialized/background heartbeat, listener cleanup, coalesced reads, bounded reads and local close')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
