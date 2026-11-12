const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const compile = code => ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function source(file) {
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const nodes = []
  function visit(node) { nodes.push(node); ts.forEachChild(node, visit) }
  visit(tree)
  return { tree, nodes, declaration(name) {
    const node = nodes.find(node => (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name)
    assert(node, name)
    return (ts.isVariableDeclaration(node) ? 'const ' : '') + node.getText(tree)
  } }
}
async function main() {
  const presenter = source('src/routes/PresenterPage.tsx')
  const calls = []
  const capture = { Error,
    activeSelectionPointerId: { current: 1 }, selectionStartRef: { current: { x: 0, y: 0 } }, selectionRectRef: { current: null },
    selectionRectangle: () => ({ x: 0, y: 0, width: 200, height: 100 }),
    cropCapture: async () => { throw Error('image decode failed') },
    returnToClassView: () => calls.push('menu'), logDiagnostic: () => calls.push('diagnostic'),
    window: { interactDesktop: { finishCaptureSelection: async expanded => { calls.push(expanded); throw Error('IPC failed') } } },
  }
  for (const name of ['SelectionMode', 'CaptureSource', 'SelectionRect', 'CaptureFile', 'CapturePreviewUrl', 'AnalysisError']) capture[`set${name}`] = value => calls.push([name, value])
  vm.createContext(capture)
  vm.runInContext(compile(presenter.declaration('cancelSelection') + presenter.declaration('finishSelection') + ';globalThis.finish=finishSelection'), capture)
  capture.finish({ pointerId: 1, clientX: 200, clientY: 100, preventDefault() {}, currentTarget: { hasPointerCapture: () => false } })
  await new Promise(resolve => setImmediate(resolve))
  assert(calls.includes('menu'), 'Decode and IPC failure must still return to the teacher menu')
  assert(calls.some(value => Array.isArray(value) && value[0] === 'AnalysisError' && /image decode failed/.test(value[1])))
  assert.equal(capture.activeSelectionPointerId.current, null)
  assert(calls.includes(true), 'Cancelled capture must restore expanded controls, not just the QR code')

  const participant = source('src/routes/ParticipantPage.tsx')
  const state = { QuizData: { items: ['unfinished form'] } }
  const context = {
    screenDispatchQuestion: (() => {
      const exports = {}
      vm.runInNewContext(compile(fs.readFileSync('src/lib/screenDispatch.ts', 'utf8')), { exports })
      return exports.screenDispatchQuestion
    })(),
    isSupabaseConfigured: true, sessionId: 'session', participantId: 'student', participantToken: 'token', locale: 'zh-TW',
    navigator: { onLine: true }, goneSessionId: { current: '' }, loadSequence: { current: 0 },
    participantRevision: { current: { current: () => 0, accepts: () => true } },
    loadedQuizQuestionId: { current: 'quiz' }, coalescedLoad: { current: fn => fn() }, useCallback: fn => fn,
    participantFunctionMessage: async () => 'temporarily unavailable',
    markSessionGone: () => {},
    readCache: { current: { scope() {}, read: (_key, load) => load() } }, handMutation: { current: false },
  }
  for (const node of participant.nodes) {
    if (ts.isIdentifier(node) && /^set[A-Z]/.test(node.text)) context[node.text] = value => { state[node.text.slice(3)] = value }
  }
  context.requireSupabase = () => ({ from: table => {
    let single = false
    const data = table === 'sessions' ? { status: 'active', current_question_id: 'quiz' }
      : table === 'participants' ? { id: 'student' }
      : table === 'questions' ? { id: 'quiz', type: 'custom_quiz', answer_round: 1 } : []
    const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
      single: () => { single = true; return q }, maybeSingle: () => { single = true; return q },
      then: resolve => Promise.resolve({ data: table === 'questions' && !single ? [data] : data, error: null }).then(resolve) }
    return q
  }, functions: { invoke: async () => ({ error: { context: { status: 503 } } }) } })
  vm.createContext(context)
  vm.runInContext(compile(participant.declaration('quizLoadCanRetry') + participant.declaration('loadAll') + ';globalThis.load=loadAll;globalThis.retry=quizLoadCanRetry'), context)
  await context.load()
  assert.deepEqual(state.QuizData, { items: ['unfinished form'] }, 'A transient refresh must not unmount an unfinished quiz')
  assert.equal(state.QuizLoadRetryable, true)
  for (const status of [408, 429, 500, 503]) assert.equal(context.retry({ context: { status } }), true)
  for (const status of [400, 401, 403, 404]) assert.equal(context.retry({ context: { status } }), false)
  const effect = participant.nodes.find(node => ts.isCallExpression(node) && node.expression.getText(participant.tree) === 'useEffect' && node.getText(participant.tree).includes('!quizWaiting'))
  assert(effect)
  let tick, delay, loads = 0
  const timer = { pageVisible: true, liveSessionId: 'session', participantToken: 'token', question: { type: 'custom_quiz' },
    quizData: null, quizLoadError: '503', quizWaiting: true, navigator: { onLine: true }, Date,
    classroomRetryDelay: () => 1500, setTimeout: (fn, ms) => { tick = fn; delay = ms; return 1 }, clearTimeout() {},
    loadAll: async () => { loads++ }, useEffect: fn => fn() }
  vm.runInNewContext(compile(effect.getText(participant.tree)), timer)
  assert.equal(delay, 10_000, 'Transient error retries must back off')
  await tick(); assert.equal(loads, 1)
  timer.navigator.onLine = false; await tick(); assert.equal(loads, 1)
  tick = null; timer.pageVisible = false
  vm.runInNewContext(compile(effect.getText(participant.tree)), timer)
  assert.equal(tick, null, 'Hidden pages must not poll quizzes')
  timer.pageVisible = true; timer.quizWaiting = false
  vm.runInNewContext(compile(effect.getText(participant.tree)), timer)
  assert.equal(tick, null, 'Authentication errors must not loop')
  console.log('PASS: capture decode/IPC recovery, expanded menu, quiz answer preservation, transient retry/backoff, offline/hidden/auth guards; no paid APIs')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
