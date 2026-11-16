const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function moduleAt(file, globals = {}) {
  const exports = {}
  vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, ...globals })
  return exports
}
const { createClassroomReadCache, classroomRetryDelay } = moduleAt('src/lib/classroomReadCache.ts')
const { screenDispatchQuestion, supportingScreenQuestion } = moduleAt('src/lib/screenDispatch.ts')
const { classroomChanges } = moduleAt('src/lib/classroomBroadcast.ts')
const text = fs.readFileSync('src/routes/ParticipantPage.tsx', 'utf8')
const tree = ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const nodes = []
function visit(node) { nodes.push(node); ts.forEachChild(node, visit) }
visit(tree)
function declaration(name) {
  const node = nodes.find(n => (ts.isFunctionDeclaration(n) || ts.isVariableDeclaration(n)) && n.name?.getText(tree) === name)
  assert(node, name)
  return (ts.isVariableDeclaration(node) ? 'const ' : '') + node.getText(tree)
}
const loadCode = compile(declaration('loadAll') + ';globalThis.load=loadAll')
const setterNames = new Set(nodes.filter(ts.isIdentifier).map(n => n.text).filter(n => /^set[A-Z]/.test(n)))
const baseTables = ['sessions', 'participants', 'exit_tickets', 'shared_contents', 'session_events', 'questions', 'answers']
let clock = 0, baseReads = 0, detailReads = 0
function client(index) {
  const state = {}, session = { id: `session-${index}`, status: 'active', current_question_id: 'quiz', board_question_id: 'board' }
  const context = { screenDispatchQuestion, supportingScreenQuestion, Error, Date, console, locale: 'zh-TW', sessionId: session.id, participantId: `student-${index}`, participantToken: 'token',
    isSupabaseConfigured: true, navigator: { onLine: true }, participantRevision: { current: { current: () => 0, accepts: () => true, changed() {} } },
    loadSequence: { current: 0 }, goneSessionId: { current: '' }, loadedQuizQuestionId: { current: '' }, handMutation: { current: false },
    coalescedLoad: { current: fn => fn() }, readCache: { current: createClassroomReadCache(() => clock) }, useCallback: fn => fn,
    markSessionGone: () => { state.gone = true }, quizLoadCanRetry: () => true, participantFunctionMessage: async () => 'temporary',
  }
  for (const name of setterNames) context[name] = value => { const key = name.slice(3); state[key] = typeof value === 'function' ? value(state[key]) : value }
  context.requireSupabase = () => ({ from: table => {
    const filters = {}
    const q = { select: () => q, eq: (key, value) => { filters[key] = value; return q }, order: () => q, limit: () => q, in: () => q,
      single: () => q, maybeSingle: () => q, then: resolve => {
        if (baseTables.includes(table)) baseReads++; else detailReads++
        const questions = context.fixtureQuestions || [{ id: session.current_question_id, type: 'custom_quiz', status: 'active', answer_round: 1, screenshot_id: 'shot' },
          { id: 'board', type: 'board', status: 'active', screenshot_id: 'board-shot', share_screenshot: true }]
        const data = table === 'sessions' ? session : table === 'participants' ? { id: context.participantId }
          : table === 'questions' ? (filters.id ? questions.find(q => q.id === filters.id) : questions)
          : table === 'screenshots' ? { id: filters.id, public_url: 'fixture.png' } : []
        return Promise.resolve({ data: structuredClone(data), error: null }).then(resolve)
      } }
    return q
  }, functions: { invoke: async () => ({ data: { generating: true }, error: null }) } })
  vm.createContext(context)
  vm.runInContext(loadCode, context)
  return { context, state, session }
}
async function main() {
  let now = 0, calls = 0, finish
  const cache = createClassroomReadCache(() => now)
  cache.scope('student-a')
  const fetch = () => { calls++; return new Promise(resolve => { finish = resolve }) }
  const a = cache.read('questions', fetch), b = cache.read('questions', fetch)
  await Promise.resolve(); assert.equal(calls, 1)
  cache.invalidate('questions'); finish({ data: ['old'] }); await Promise.all([a, b])
  assert.equal((await cache.read('questions', async () => ({ data: ['new'] }))).data[0], 'new')
  for (let i = 0; i < 2; i++) await cache.read('error', async () => { calls++; return { error: '503' } })
  assert.equal(calls, 3, 'Errors must never be cached')
  await assert.rejects(cache.read('throw', async () => { throw Error('offline') }), /offline/)
  cache.scope('student-b'); assert.equal((await cache.read('questions', async () => ({ data: ['other'] }))).data[0], 'other')
  await cache.read('screenshots:none', async () => { calls++; return { data: null } }, 60_000, 2000)
  now = 2001; await cache.read('screenshots:none', async () => { calls++; return { data: 'ready' } }, 60_000, 2000)
  assert.equal(calls, 5)
  assert.equal(classroomRetryDelay(0, 0), 1500); assert.equal(classroomRetryDelay(90_000, 1), 9500)

  const clients = Array.from({ length: 200 }, (_, i) => client(i))
  for (let tick = 0; tick < 60; tick++) {
    clock = tick * 2000
    await Promise.all(clients.map(c => c.context.load()))
  }
  const baseline = 200 * 60 * baseTables.length
  assert(baseReads < baseline * .15, `${baseReads}/${baseline}: repeated grading must reuse shared datasets`)
  const model = { simulatedStudents: 200, refreshesEach: 60, baselineBaseReads: baseline, cachedBaseReads: baseReads, cachedDetailReads: detailReads, reductionPercent: Math.round((1 - baseReads / baseline) * 100) }
  for (const c of clients) assert.equal(c.state.BoardQuestion.status, 'active', 'The discussion board stays open')
  const supplement = client(999)
  supplement.context.fixtureQuestions = [
    { id: 'quiz', type: 'custom_quiz', status: 'active', created_at: '2026-11-12T01:00:00Z', screenshot_id: 'shot' },
    { id: 'screen', type: 'send_screen', status: 'active', created_at: '2026-11-12T02:00:00Z', screenshot_id: 'new-shot' },
  ]
  supplement.session.current_question_id = 'screen'
  await supplement.context.load()
  assert.equal(supplement.state.Question.id, 'quiz', 'Screenshot must not replace the unfinished quiz')
  assert.equal(supplement.state.SupportingScreen.id, 'new-shot')
  assert.equal(supplement.state.Screenshot.id, 'shot', 'Original question retains its own image')
  supplement.session.current_question_id = 'quiz'
  supplement.context.readCache.current.invalidate()
  await supplement.context.load()
  assert.equal(supplement.state.Question.id, 'quiz')
  assert.equal(supplement.state.SupportingScreen.id, 'new-shot', 'Keep teacher controls aimed at the real activity')
  // Real Realtime handlers must bypass TTL immediately, not wait a minute.
  const c = clients[0], handlers = []
  const channel = { on: (_kind, filter, fn) => { handlers.push({ filter, fn }); return channel }, subscribe: () => channel }
  let scheduled = 0
  c.context.useEffect = fn => fn()
  c.context.liveSessionId = c.session.id
  c.context.scheduleLoad = () => scheduled++
  c.context.refreshParticipantRow = () => {}
  c.context.pageVisible = true
  c.context.sessionGone = false
  c.context.broadcastSync = false
  c.context.classroomChanges = classroomChanges
  c.context.classroomReconnect = { current: { subscribed() {} } }
  const db = c.context.requireSupabase()
  c.context.requireSupabase = () => ({ ...db, channel: () => channel, removeChannel() {} })
  const effect = nodes.find(n => ts.isCallExpression(n) && n.expression.getText(tree) === 'useEffect' && n.getText(tree).includes('const channel = classroomChanges('))
  vm.runInContext(compile(effect.getText(tree)), c.context)
  const lifecycle = nodes.find(n => ts.isCallExpression(n) && n.expression.getText(tree) === 'useEffect' && n.getText(tree).includes('.channel(`participant-session:'))
  vm.runInContext(compile(lifecycle.getText(tree)), c.context)
  c.session.current_question_id = 'next-quiz'
  c.session.danmaku_enabled = false
  handlers.find(h => h.filter.table === 'sessions' && h.filter.event === 'UPDATE').fn()
  handlers.find(h => h.filter.table === 'questions').fn()
  await c.context.load()
  assert.equal(c.state.Question.id, 'next-quiz')
  assert.equal(c.state.Session.danmaku_enabled, false, 'The stored teacher switch must bypass session cache immediately')
  assert(scheduled > 0)
  for (const table of ['answers', 'screenshots', 'exit_tickets', 'ai_summaries', 'shared_contents']) {
    handlers.find(h => h.filter.table === table).fn()
  }

  const sendCode = compile(declaration('sendMessage') + ';globalThis.send=sendMessage')
  const questionTypes = fs.readFileSync('src/types/index.ts', 'utf8').match(/export type QuestionType = (.*)/)[1].match(/'([^']+)'/g).map(value => value.slice(1, -1))
  for (const type of questionTypes) {
    let writes = 0, release
    const s = { Error, message: '尚未回答也能發問', participant: { id: 'student', name: 'Student' }, sessionId: 'class',
      session: { status: 'active', anonymous_enabled: true }, question: { type, status: 'active' }, answer: null,
      onBreak: true, danmakuOpen: true, messageSending: { current: false }, messageFitsLimit: () => true,
      setError() {}, setMessageBusy() {}, setMessage() {},
      requireSupabase: () => ({ from: () => ({ insert: () => { writes++; return new Promise(resolve => { release = resolve }) } }) }),
    }
    vm.createContext(s); vm.runInContext(sendCode, s)
    const first = s.send({ preventDefault() {} })
    await s.send({ preventDefault() {} }); assert.equal(writes, 1, `${type}: duplicate clicks must not duplicate messages`)
    release({ error: null }); await first
    assert.equal(s.messageSending.current, false)
    s.danmakuOpen = false; await s.send({ preventDefault() {} }); assert.equal(writes, 1, 'Teacher off switch is still authoritative')
    s.danmakuOpen = true; s.session.status = 'ended'; await s.send({ preventDefault() {} }); assert.equal(writes, 1, 'Ended class cannot send')
  }
  const form = nodes.find(n => ts.isJsxElement(n) && n.openingElement.tagName.getText(tree) === 'form' && n.openingElement.getText(tree).includes('message-form'))
  assert(form && !form.parent.getText(tree).startsWith('!onBreak'), 'Message form cannot be hidden by teacher Presence')
  assert(!declaration('sendMessage').includes('Boolean(answer)'))

  let tasks = [], tracked = 0
  const { createPresencePublisher } = moduleAt('src/lib/presencePublisher.ts', { setTimeout: (fn, ms) => { tasks.push({ fn, ms }); return tasks.length }, clearTimeout: () => { tasks = [] } })
  const publisher = createPresencePublisher(async () => ++tracked === 1 ? 'error' : 'ok')
  publisher.start(); for (let i = 0; i < 5; i++) await Promise.resolve()
  assert.equal(tasks.length, 1); assert(tasks[0].ms >= 1500)
  await tasks.shift().fn(); for (let i = 0; i < 5; i++) await Promise.resolve()
  assert.equal(tracked, 2); assert.equal(tasks.length, 0)
  const failed = createPresencePublisher(async () => 'error')
  failed.start(); for (let i = 0; i < 5; i++) await Promise.resolve()
  failed.cancel(); assert.equal(tasks.length, 0)
  console.log('PASS: actual student loadAll under 200-client model, targeted Realtime invalidation, board preservation, comment/answer independence, duplicate clicks, teacher switch and Presence retries')
  console.log(JSON.stringify(model))
}
main().catch(error => { console.error(error); process.exitCode = 1 })
