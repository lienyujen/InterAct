const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const compile = file => ts.transpile(fs.readFileSync(file, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const flush = async () => { for (let i = 0; i < 35; i++) await Promise.resolve() }

function clock() {
  let now = Date.parse('2026-10-09T06:00:00Z')
  let id = 0
  const timers = new Map()
  class TestDate extends Date { static now() { return now } }
  const globals = {
    Date: TestDate,
    setTimeout: (fn, delay) => { timers.set(++id, { fn, due: now + delay }); return id },
    clearTimeout: handle => timers.delete(handle),
  }
  return { globals, timers, async tick(ms) {
    const end = now + ms
    for (;;) {
      const next = [...timers].filter(([, item]) => item.due <= end).sort((a, b) => a[1].due - b[1].due)[0]
      if (!next) break
      now = next[1].due; timers.delete(next[0]); next[1].fn(); await flush()
    }
    now = end; await flush()
  } }
}

function load(file, globals = {}) {
  const context = { exports: {}, require, ...globals }
  vm.runInNewContext(compile(file), context)
  return context.exports
}

async function main() {
  const time = clock()
  const helpers = load('src/lib/realtimeSnapshot.ts', time.globals)
  const cache = helpers.createRealtimeSnapshot()
  cache.replace({ participants: [{ id: 'p', hand_raised_at: 'raised' }], participant_points: [{ id: 'award', points: 1 }] })
  cache.begin()
  cache.update('participants', { eventType: 'UPDATE', new: { id: 'p', hand_raised_at: null }, old: {} })
  cache.update('participant_points', { eventType: 'DELETE', new: {}, old: { id: 'award' } })
  cache.replace({ participants: [{ id: 'p', hand_raised_at: 'raised' }], participant_points: [{ id: 'award', points: 1 }] })
  assert.equal(cache.rows('participants')[0].hand_raised_at, null, 'old HTTP response cannot raise a lowered hand')
  assert.equal(cache.rows('participant_points').length, 0, 'deleted points must not reappear')
  cache.update('participants', { eventType: 'UPDATE', new: { id: 'p', hand_raised_at: null }, old: {} })
  assert.equal(cache.rows('participants').length, 1, 'duplicate events must not duplicate rows')

  const guard = helpers.createRevisionGuard()
  const started = guard.current(); guard.changed()
  assert.equal(guard.accepts(started), false, 'old heartbeat, mutation or snapshot cannot overwrite newer realtime')

  let calls = 0; let active = 0; let max = 0; let finish
  const batch = helpers.createBatchedRefresh(() => {
    calls++; active++; max = Math.max(max, active)
    return new Promise(resolve => { finish = () => { active--; resolve() } })
  })
  for (let i = 0; i < 145; i++) batch.request()
  await time.tick(350)
  assert.equal(calls, 1, '145 simultaneous requests coalesce into one update')
  for (let i = 0; i < 145; i++) batch.request()
  await time.tick(5000)
  assert.equal(calls, 1, 'a slow response cannot spawn parallel refreshes')
  finish(); await flush(); await time.tick(350)
  assert.equal(calls, 2); assert.equal(max, 1)
  batch.stop(); finish(); await flush(); await time.tick(2000)
  assert.equal(calls, 2, 'cleanup cancels queued work')

  const hookClock = clock()
  const snapshots = load('src/lib/realtimeSnapshot.ts', hookClock.globals)
  const participation = load('src/lib/participation.ts', hookClock.globals)
  const db = {
    participants: Array.from({ length: 145 }, (_, i) => ({ id: `p${i}`, session_id: 'class', name: `test${i}`, joined_at: '2026-10-09T06:00:00Z', last_seen_at: '2026-10-09T06:00:00Z', hand_raised_at: null })),
    questions: [{ id: 'q', session_id: 'class', type: 'multiple_choice', status: 'active' }],
    answers: [], messages: [], session_events: [], participant_points: [],
  }
  const bindings = []; const sent = []; const cleanups = []; const intervals = []; const listeners = new Map()
  let reads = 0; let privateReads = 0; let failReads = false; let subscribed
  const channel = {
    on(type, filter, callback) { bindings.push({ type, filter, callback }); return this },
    subscribe(callback) { subscribed = callback; callback('SUBSCRIBED'); return this },
    async send(message) { sent.push(message); return 'ok' },
  }
  const client = {
    channel: () => channel, removeChannel: () => {},
    from(table) {
      reads++
      const query = { select() { return this }, eq() { return this }, order() { return this }, limit() { return this },
        then(resolve) { return Promise.resolve({ data: db[table], error: failReads ? new Error('offline fixture') : null }).then(resolve) } }
      return query
    },
    functions: { async invoke(_name, options) {
      privateReads++
      const action = options.body.action
      return { data: action.includes('quiz') ? { attempts: [] } : action.includes('board') ? { posts: [] } : { responses: [] }, error: null }
    } },
  }
  const api = load('src/lib/standings.ts', {
    ...hookClock.globals,
    navigator: { onLine: true },
    window: { ...hookClock.globals, setInterval: fn => { intervals.push(fn); return intervals.length }, clearInterval: () => {},
      addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) },
    require: name => name === 'react' ? { useRef: current => ({ current }), useCallback: fn => fn, useState: () => [null, () => {}], useEffect: fn => { const cleanup = fn(); if (cleanup) cleanups.push(cleanup) } }
      : name.includes('participation') ? participation : name.includes('presenterAuth') ? { getReportCredentials: () => ({ sessionId: 'class', presenterToken: 'fixture' }) }
      : name.includes('realtimeSnapshot') ? snapshots : { requireSupabase: () => client },
  })
  api.useStandingsBroadcast('class', 'presence')
  await hookClock.tick(350); await hookClock.tick(1000)
  assert.equal(reads, 6); assert.equal(privateReads, 3)
  const initialScore = sent.at(-1).payload.rows.find(row => row.id === 'p0').score
  const emit = (table, eventType, row) => bindings.find(binding => binding.type === 'postgres_changes' && binding.filter.table === table).callback({ eventType, new: eventType === 'DELETE' ? {} : row, old: eventType === 'DELETE' ? row : {} })
  for (let i = 0; i < 145; i++) {
    const row = { id: `award${i}`, session_id: 'class', participant_id: `p${i}`, points: 1 }
    db.participant_points.push(row); emit('participant_points', 'INSERT', row)
  }
  const sentBefore = sent.length
  await hookClock.tick(1000)
  assert.equal(sent.length, sentBefore + 1)
  assert.equal(sent.at(-1).payload.rows.find(row => row.id === 'p0').score, initialScore + 1)
  assert.equal(reads, 6, 'awarding the whole class must do zero extra database reads')
  assert.equal(privateReads, 3)
  const beforeUnchanged = sent.length
  emit('participants', 'UPDATE', db.participants[0])
  await hookClock.tick(1000)
  assert.equal(sent.length, beforeUnchanged, 'unchanged scores must not broadcast on every heartbeat')
  emit('participant_points', 'DELETE', db.participant_points.shift())
  await hookClock.tick(1000)
  assert.equal(sent.at(-1).payload.rows.find(row => row.id === 'p0').score, initialScore)
  emit('messages', 'INSERT', { id: 'message', session_id: 'class', participant_id: 'p0' })
  await hookClock.tick(1000)
  assert.equal(sent.at(-1).payload.rows.find(row => row.id === 'p0').score, initialScore + 2)
  assert.equal(reads, 6)
  bindings.find(binding => binding.type === 'broadcast' && binding.filter.event === 'score_sources_changed').callback({ payload: { source: 'quiz' } })
  await hookClock.tick(1000)
  assert.equal(privateReads, 4, 'answer-key corrections reload only the private quiz source')
  assert.equal(reads, 6)
  failReads = true
  const beforeFailure = sent.length
  intervals[0](); await hookClock.tick(1000)
  assert.equal(sent.length, beforeFailure, 'failed reads must retain last good scores, not broadcast zeros')
  failReads = false
  subscribed('SUBSCRIBED'); await hookClock.tick(1000)
  assert.equal(sent.length, beforeFailure + 1, 'reconnect must immediately reconcile')
  cleanups.forEach(cleanup => cleanup())
  assert.equal(listeners.size, 0)

  const ownBindings = []; const ownUpdates = []; let handSyncs = 0
  const ownApi = load('src/lib/standings.ts', {
    require: name => name === 'react' ? { useState: () => [null, row => ownUpdates.push(row)], useRef: current => ({ current }), useEffect: fn => fn() }
      : { requireSupabase: () => ({ channel: () => ({ on(type, filter, callback) { ownBindings.push({ type, filter, callback }); return this }, subscribe() {} }), removeChannel() {} }) },
  })
  ownApi.useMyStanding('class', 'p0', () => handSyncs++)
  const scores = ownBindings.find(binding => binding.filter.event === 'standings').callback
  scores({ payload: { sentAt: 200, rows: [{ id: 'p0', score: 12 }] } })
  scores({ payload: { sentAt: 100, rows: [{ id: 'p0', score: 3 }] } })
  assert.equal(ownUpdates.length, 1, 'out-of-order broadcasts cannot roll back scores')
  const hands = ownBindings.find(binding => binding.filter.event === 'hands_lowered').callback
  hands({ payload: { participantId: 'another-student' } }); assert.equal(handSyncs, 0)
  hands({ payload: { participantId: 'p0' } }); hands({ payload: { participantId: '' } }); assert.equal(handSyncs, 2)

  // Execute the student's real hand mutation, including SDK errors that do
  // not throw and a newer teacher-lowered event while its ACK is in flight.
  const page = fs.readFileSync('src/routes/ParticipantPage.tsx', 'utf8')
  const handStart = page.indexOf('  async function toggleHand()')
  const handEnd = page.indexOf('\n  return (', handStart)
  for (const mode of ['sdk-error', 'newer-realtime']) {
    let resolveRequest
    const revision = helpers.createRevisionGuard()
    const context = { participant: { id: 'p0', hand_raised_at: null }, participantId: 'p0', participantToken: 'fixture', sessionId: 'class', handBusy: false,
      participantRevision: { current: revision }, Date,
      setHandBusy: value => { context.handBusy = value },
      setParticipant: update => { context.participant = update(context.participant) },
      requireSupabase: () => ({ functions: { invoke: () => new Promise(resolve => { resolveRequest = resolve }) } }),
    }
    vm.createContext(context)
    vm.runInContext(ts.transpile(page.slice(handStart, handEnd), { target: ts.ScriptTarget.ES2022 }), context)
    const pending = context.toggleHand()
    assert.ok(context.participant.hand_raised_at, 'tap updates immediately')
    if (mode === 'sdk-error') resolveRequest({ error: new Error('fixture failure') })
    else {
      revision.changed(); context.participant.hand_raised_at = null
      resolveRequest({ data: { participantState: { id: 'p0', hand_raised_at: 'old-server-ack' } }, error: null })
    }
    await pending
    assert.equal(context.participant.hand_raised_at, null)
    assert.equal(context.handBusy, false)
  }

  const sessionId = '11111111-1111-4111-8111-111111111111'
  const participantId = '22222222-2222-4222-8222-222222222222'
  for (const action of ['heartbeat', 'set_hand']) for (const authorized of [true, false]) {
    let handler; let writes = 0
    const participant = { id: participantId, session_id: sessionId, name: 'fixture', hand_raised_at: null }
    const client = { from(table) {
      const query = { select() { return this }, eq() { return this }, update() { writes++; return this },
        async maybeSingle() { return { data: table === 'participant_session_keys' && authorized ? { participants: participant } : null } },
        async single() { return { data: participant, error: null } },
      }
      return query
    }, async rpc() { writes++; return { error: null } } }
    load('supabase/functions/participant-action/index.ts', { Response, console, Deno: { serve: fn => { handler = fn } },
      require: name => name.includes('/supabase') ? { getAdminClient: () => client, hashParticipantToken: async () => 'fixture-hash' }
        : { corsHeaders: {}, jsonResponse: (body, status = 200) => Response.json(body, { status }), errorDetail: error => String(error) },
    })
    const response = await handler({ method: 'POST', json: async () => ({ action, sessionId, participantId, participantToken: 'x'.repeat(40), raised: false }) })
    assert.equal(response.status, authorized ? 200 : 403)
    if (authorized) assert.equal((await response.json()).participantState.id, participantId)
    else assert.equal(writes, 0, 'invalid participant credentials must never write')
  }

  let removed = 0
  const notifications = []; const deferred = []
  const notifier = load('supabase/functions/_shared/classroom-sync.ts', { console, EdgeRuntime: { waitUntil: task => deferred.push(task) } })
  const notifyingClient = { channel(topic) { return { httpSend: async (event, payload) => notifications.push({ topic, event, payload }) } }, async removeChannel() { removed++ } }
  notifier.notifyHandsLowered(notifyingClient, 'class', 'p0')
  notifier.notifyQuizScoreChanged(notifyingClient, 'class')
  await Promise.all(deferred)
  assert.equal(notifications[0].topic, 'standings:class')
  assert.deepEqual(Object.keys(notifications[0].payload), ['participantId'])
  assert.equal(notifications[1].payload.source, 'quiz')
  assert.equal(removed, 2, 'server notifications must release channels')
  console.log('PASS: 145-student event bursts, immediate cached awards/messages, undo, serial refresh, stale snapshots, reconnect, failed reads and targeted hand sync')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
