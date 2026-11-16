const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const exports_ = {}
vm.runInNewContext(ts.transpile(fs.readFileSync('src/lib/classroomBroadcast.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }), { exports: exports_ })
const { classroomChanges, classroomBroadcastTables, createClassroomReconnect } = exports_
function fixture() {
  const bindings = [], reads = []
  const channel = { on(type, filter, callback) { bindings.push({ type, filter, callback }); return this } }
  const client = { channel: () => channel, from(table) {
    const filters = {}
    const query = { select: () => query, eq(k, v) { filters[k] = v; return query }, async maybeSingle() {
      reads.push({ table, ...filters }); return { data: { ...filters, name: 'authoritative' } }
    } }; return query
  } }
  return { client, bindings, reads }
}
async function main() {
  let database = 0, broadcasts = 0
  for (let i = 0; i < 200; i++) {
    const f = fixture(), c = classroomChanges(f.client, 'class', `student-${i}`, true)
    for (const table of [...classroomBroadcastTables, 'answers', 'exit_tickets']) c.on('postgres_changes', { table, event: '*', filter: 'session_id=eq.class' }, () => {})
    database += f.bindings.filter(b => b.type === 'postgres_changes').length
    broadcasts += f.bindings.filter(b => b.type === 'broadcast').length
  }
  assert.equal(database, 400); assert.equal(broadcasts, 1200)
  const legacy = fixture()
  classroomChanges(legacy.client, 'class', 'me', false).on('postgres_changes', { table: 'questions' }, () => {})
  assert.equal(legacy.bindings[0].type, 'postgres_changes')
  const f = fixture(), seen = []
  classroomChanges(f.client, 'class', 'me', true).on('postgres_changes', { table: 'participants', event: 'UPDATE', filter: 'id=eq.me' }, p => seen.push(p.new))
  const valid = { table: 'participants', eventType: 'UPDATE', id: 'me', session_id: 'class', name: 'forged' }
  for (const patch of [{ id: 'other' }, { session_id: 'other' }, { eventType: 'INSERT' }, { table: 'questions' }]) await f.bindings[0].callback({ payload: { ...valid, ...patch } })
  assert.equal(f.reads.length, 0)
  await f.bindings[0].callback({ payload: valid })
  assert.equal(seen[0].name, 'authoritative'); assert.equal(f.reads.length, 1)
  let next = 0
  const pending = new Map(), delays = [], refreshes = []
  const reconnect = createClassroomReconnect(value => refreshes.push(value), () => .5,
    (run, delay) => { pending.set(++next, run); delays.push(delay); return next }, id => pending.delete(id))
  for (let i = 0; i < 200; i++) reconnect.subscribed()
  assert.equal(pending.size, 1); assert.equal(delays[0], 1050)
  pending.get(next)(); pending.delete(next)
  reconnect.subscribed(); assert.equal(delays[1], 10000)
  pending.get(next)(); pending.delete(next)
  assert.deepEqual(refreshes, [false, true])
  reconnect.subscribed(); reconnect.stop(); assert.equal(pending.size, 0)
  reconnect.subscribed(); assert.equal(pending.size, 0)
  const sql = fs.readFileSync('supabase/migrations/20261116160649_classroom_broadcast_sync.sql', 'utf8')
  assert.ok(fs.readFileSync('supabase/schema.sql', 'utf8').replaceAll('\r', '').trim().endsWith(sql.replaceAll('\r', '').trim()))
  assert.ok(sql.includes('from public, anon, authenticated'))
  if (process.env.INTERACT_PGLITE) {
    const { PGlite } = require(process.env.INTERACT_PGLITE)
    const db = new PGlite()
    await db.exec("create role anon; create role authenticated; create schema realtime; create table realtime.sent(payload jsonb, event text, topic text, private boolean); create function realtime.send(jsonb,text,text,boolean) returns void language sql as 'insert into realtime.sent values ($1,$2,$3,$4)'; create table public.sessions(id text);")
    for (const table of classroomBroadcastTables) await db.exec(`create table public.${table}(id text primary key, session_id text, last_seen_at int, unfocused_ms int, focus_streak_ms int, hand_raised_at int, name text);`)
    await db.exec(sql); await db.exec(sql)
    await db.exec("insert into participants(id,session_id,name) values ('me','class','secret'); update participants set last_seen_at=1,unfocused_ms=2,focus_streak_ms=3;")
    assert.equal((await db.query('select * from realtime.sent')).rows.length, 1, 'Telemetry is silent')
    await db.exec("update participants set hand_raised_at=10; delete from participants;")
    const rows = (await db.query('select * from realtime.sent')).rows
    assert.equal(rows.length, 3); assert.equal(rows[1].payload.eventType, 'UPDATE'); assert.equal(rows[2].payload.eventType, 'DELETE')
    assert.equal(rows[0].payload.name, undefined); assert.equal(rows[0].topic, 'classroom-changes:class')
    assert.equal((await db.query("select has_function_privilege('anon','public.notify_classroom_change()','EXECUTE') allowed")).rows[0].allowed, false)
    await db.exec("grant usage on schema public to anon; grant insert on public.participants to anon; set role anon; insert into public.participants(id,session_id) values ('learner','class'); reset role;")
    assert.equal((await db.query('select * from realtime.sent')).rows.length, 4, 'Revoked direct execution must not block legitimate participant inserts')
    await db.close()
    console.log('PASS: real Postgres trigger rerun, telemetry suppression, hand change, deletion, minimal payload and revoked public execution')
  }
  console.log('PASS: 200-client subscription model 1600 -> 400 DB bindings; own-profile filtering, authoritative reads, legacy mode and coalesced reconnects')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
