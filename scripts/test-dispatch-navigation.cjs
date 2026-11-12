const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const compile = text => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const source = fs.readFileSync('src/routes/PresenterPage.tsx', 'utf8')
const tree = ts.createSourceFile('PresenterPage.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function declaration(name) {
  let found
  function visit(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert(found, name)
  return (ts.isVariableDeclaration(found) ? 'const ' : '') + found.getText(tree)
}
const focusModule = { exports: {} }
vm.runInNewContext(compile(fs.readFileSync('src/lib/presenterQuestionFocus.ts', 'utf8')), focusModule)
const createFocus = focusModule.exports.createPresenterQuestionFocus
const request = type => ({ type, options: ['A', 'B'], promptText: 'Topic', allowMultiple: false,
  timing: { prepareSeconds: null, answerSeconds: null }, key: { choices: [], correctValues: [] },
  sliceCount: null, sliceHasAnswer: false, sentenceMode: false, shareScreenshot: true, maxPins: 1,
  boardFormats: [], cameraGestureMap: [], quizSettings: { direction: 'quiz', requestedCount: 2, requestedType: 'random' },
})
function harness({ native = true, fail = false, cameraFail = false } = {}) {
  const calls = []
  const state = { session: { current_question_id: 'old', board_question_id: 'wall' },
    questions: [{ id: 'wall', type: 'board', status: 'active' }, { id: 'old', type: 'short_answer', status: 'active' }],
    controlsOpen: false, editorOpen: true, fileTransferOpen: true, textDispatchOpen: true, settingsOpen: true,
  }
  const created = type => ({ id: `new-${type}`, type, status: 'active' })
  const context = { console, sessionId: 'session', captureFile: { name: 'shot.png' }, navigator: { onLine: true },
    questionFocus: createFocus('session'), reload: { current: fn => fn() }, isSupabaseConfigured: true,
    useCallback: fn => fn, logDiagnostic: () => {}, loadAll: async () => {},
    getPresenterToken: () => 'token', requirePresenterToken: () => 'token',
    prepareScreenshot: async () => ({ screenshotId: 'image', storagePath: 'path' }),
    generateQuestionItems: async () => ({ pairs: [{ left: 'one', right: '1' }, { left: 'two', right: '2' }] }),
    buildSlicedOptions: async () => ['tile1', 'tile2'], shuffle: values => values,
    edgeFunctionErrorMessage: async () => 'mock failure',
    localStorage: { setItem: () => {}, removeItem: () => {} },
    BroadcastChannel: class { postMessage(message) { calls.push(message.type) } close() {} },
    window: { interactDesktop: native ? { setPresenterExpanded: async (...args) => calls.push(['bounds', ...args]),
      openCameraPoll: async () => { calls.push('camera-window'); if (cameraFail) throw Error('cannot open') },
    } : undefined },
  }
  for (const name of ['Session', 'Questions', 'SelectedQuestionId', 'Question', 'Answers', 'AudioResponses', 'QuizResults', 'Analysis', 'OrderingKey',
    'QuestionScreenshotUrl', 'EditorOpen', 'FileTransferOpen', 'TextDispatchOpen', 'SettingsOpen', 'EndClassConfirmOpen', 'CloseConfirmOpen',
    'ControlsOpen', 'CaptureFile', 'CapturePreviewUrl', 'Busy', 'AnalysisError', 'CameraPollRequest', 'CameraPollResult', 'CameraPollError', 'CollectQuestion', 'FileResponses', 'Participants', 'ExitTickets', 'AnswerCounts']) {
    const key = name[0].toLowerCase() + name.slice(1)
    context[`set${name}`] = value => { state[key] = typeof value === 'function' ? value(state[key]) : value }
  }
  context.requireSupabase = () => ({ functions: { invoke: async (_name, { body }) => {
    calls.push(body.action)
    return fail ? { error: Error('failed') } : { data: { question: created(body.questionType || 'custom_quiz') } }
  } } })
  context.callPresenter = async body => {
    calls.push(body.action)
    if (fail) throw Error('failed')
    return { question: created(body.action === 'create_file_request' ? 'file_upload' : 'custom_quiz') }
  }
  vm.createContext(context)
  for (const name of ['returnToClassView', 'showDispatchedQuestion', 'cancelCameraPoll', 'uploadQuestionScreenshot', 'createScreenshotQuestion', 'createFileQuiz', 'startFileCollect', 'publishCameraPoll']) {
    vm.runInContext(compile(declaration(name)) + `;globalThis.${name}=${name}`, context)
  }
  return { context, state, calls, created }
}
function assertMenu(state) {
  assert.equal(state.controlsOpen, true)
  for (const key of ['editorOpen', 'fileTransferOpen', 'textDispatchOpen', 'settingsOpen']) assert.equal(state[key], false, key)
}
async function main() {
  const types = ['send_screen', 'poll', 'rating', 'multiple_choice', 'true_false', 'short_answer', 'pronunciation', 'oral_response', 'custom_quiz', 'file_upload', 'drawing', 'hotspot', 'ordering', 'matching', 'board']
  for (const native of [true, false]) for (const type of types) {
    const { context, state, calls } = harness({ native })
    await context.createScreenshotQuestion(request(type))
    assertMenu(state)
    assert.equal(state.question.type, type)
    assert.equal(state.selectedQuestionId, `new-${type}`)
    assert.equal(state.session.current_question_id, `new-${type}`)
    assert.equal(state.questions.find(item => item.id === 'old').status, type === 'send_screen' ? 'active' : 'stopped')
    assert.equal(state.questions.find(item => item.id === 'wall').status, type === 'board' ? 'stopped' : 'active')
    assert.equal(state.session.board_question_id, type === 'board' ? 'new-board' : 'wall')
    assert(!calls.includes('camera-window'), `Only camera dispatch may open a large native window: ${type}`)
    assert.equal(state.busy, false)
  }
  const sliced = harness()
  await sliced.context.createScreenshotQuestion({ ...request('ordering'), sliceCount: 4 })
  assertMenu(sliced.state)
  for (const method of ['createFileQuiz', 'startFileCollect']) {
    const h = harness()
    await h.context[method]('file', { direction: 'quiz' })
    assertMenu(h.state)
    assert.equal(h.state.question.type, method === 'createFileQuiz' ? 'custom_quiz' : 'file_upload')
    assert.equal(h.state.questions.find(item => item.id === 'wall').status, 'active')
  }
  const failed = harness({ fail: true })
  await failed.context.createScreenshotQuestion(request('matching'))
  assert.equal(failed.state.editorOpen, true, 'Failed dispatch keeps the editor for retry')
  assert.equal(failed.state.busy, false)
  assert.match(failed.state.analysisError, /失敗/)
  const camera = harness()
  await camera.context.createScreenshotQuestion(request('camera_poll'))
  assert(camera.calls.includes('camera-window'))
  assert(!camera.calls.includes('create_question'), 'Camera captures are reviewed before dispatch')
  camera.context.cameraPollRequest = request('camera_poll')
  await camera.context.publishCameraPoll({ counts: [1, 2] })
  assertMenu(camera.state)
  assert(camera.calls.includes('published'))
  camera.context.cancelCameraPoll()
  assertMenu(camera.state)
  assert.equal(camera.state.cameraPollRequest, null)
  const cameraFail = harness({ cameraFail: true })
  await cameraFail.context.createScreenshotQuestion(request('camera_poll'))
  assertMenu(cameraFail.state)

  const focus = createFocus('session')
  const oldSnapshot = focus.snapshot()
  focus.dispatch('new')
  assert.equal(focus.accepts(oldSnapshot), false)
  assert.equal(focus.reconcile(oldSnapshot, 'old', ['old']), null)
  focus.reconcile(focus.snapshot(), 'new', ['old', 'new'])
  focus.select('old')
  assert.equal(focus.reconcile(focus.snapshot(), 'new', ['old', 'new']).questionId, 'old', 'History selection stays intentional')
  focus.dispatch('newest')
  assert.equal(focus.snapshot().questionId, 'newest')
  assert.equal(focus.accepts(createFocus('other').snapshot()), false)

  const stale = harness()
  let release
  const hold = new Promise(resolve => { release = resolve })
  stale.context.requireSupabase = () => ({ from: table => {
    const query = { select: () => query, eq: () => query, order: () => query, single: () => query,
      then: (resolve, reject) => hold.then(() => ({ data: table === 'sessions' ? { current_question_id: 'old' } : [] })).then(resolve, reject),
    }; return query
  } })
  vm.runInContext(compile(declaration('loadAll')) + ';globalThis.loadAll=loadAll', stale.context)
  const pending = stale.context.loadAll()
  stale.context.questionFocus.dispatch('new-confirmed')
  stale.state.session = { current_question_id: 'new-confirmed' }
  release()
  await pending
  assert.equal(stale.state.session.current_question_id, 'new-confirmed', 'Late snapshot must not restore previous activity')

  // Execute the real stop-query expressions, without invoking Gemini or a DB.
  const backendText = fs.readFileSync('supabase/functions/presenter-action/index.ts', 'utf8')
  const backend = ts.createSourceFile('presenter-action.ts', backendText, ts.ScriptTarget.Latest, true)
  for (const action of ['create_custom_quiz', 'create_question', 'create_file_request', 'recall_question']) {
    let branch, stop
    function find(node) {
      if (ts.isIfStatement(node) && node.expression.getText(backend) === `action === '${action}'`) branch = node.thenStatement
      ts.forEachChild(node, find)
    }
    find(backend)
    function visit(node) {
      if (ts.isVariableDeclaration(node) && /stop\w*Error/.test(node.name.getText(backend)) && node.initializer) stop = node.initializer.getText(backend)
      ts.forEachChild(node, visit)
    }
    visit(branch)
    if (action === 'create_question') {
      const guards = []
      function guardsFor(node) {
        if (ts.isIfStatement(node) && node.expression.getText(backend) === "type !== 'send_screen'") guards.push(node.thenStatement.getText(backend))
        ts.forEachChild(node, guardsFor)
      }
      guardsFor(branch)
      assert(guards.some(body => body.includes(stop)), 'Pure screenshots must skip the stop query')
    }
    assert(stop, `${action} closes earlier ordinary questions`)
    const rows = [{ type: 'board', status: 'active' }, { type: 'poll', status: 'active' }]
    const filters = []
    const query = { update: () => query, eq: (key, value) => { if (key === 'status') filters.push(row => row.status === value); return query },
      neq: (key, value) => { filters.push(row => row[key] !== value); return query },
      then: resolve => { rows.filter(row => filters.every(filter => filter(row))).forEach(row => { row.status = 'stopped' }); return Promise.resolve({ error: null }).then(resolve) },
    }
    await vm.runInNewContext(compile(`(async () => { ${stop}; })()`), { supabase: { from: () => query }, sessionId: 'session', questionId: 'recalled', target: { id: 'recalled' }, stoppedAt: 'now', recalledAt: 'now' })
    assert.equal(rows[0].status, 'active', `${action} must preserve the open discussion board`)
    assert.equal(rows[1].status, 'stopped')
  }
  console.log('PASS: all screenshot types, sliced ordering, file quiz/upload, camera review/cancel/failure, stale snapshots, manual history and persistent discussion boards; no paid API calls')
  const screenModule = { exports: {} }
  vm.runInNewContext(compile(fs.readFileSync('src/lib/screenDispatch.ts', 'utf8')), screenModule)
  const select = screenModule.exports.screenDispatchQuestion
  const screen = { id: 'screen', type: 'send_screen', status: 'active' }
  for (const type of types.filter(t => !['send_screen', 'board'].includes(t))) {
    const original = { id: 'original', type, status: 'active', created_at: '2026-11-12' }
    assert.equal(select(screen, [screen, original]).id, 'original', `${type} remains answerable alongside the screenshot`)
    assert.equal(select(screen, [screen, { ...original, status: 'stopped' }]).id, 'screen', 'Never reopen stopped activities')
  }
  assert.equal(select(screen, [screen, { type: 'board', status: 'active' }]).id, 'screen')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
