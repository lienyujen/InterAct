// Exercise the real window bounds and presenter navigation without connecting
// to Supabase, starting Electron, or making paid API calls.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const main = fs.readFileSync('electron/main.cjs', 'utf8')
const initialArea = { x: 0, y: 0, width: 1536, height: 824 }
const context = {
  mainWindow: { isDestroyed: () => false, setBounds: bounds => { context.bounds = bounds } },
  lastControlBounds: { x: 1000, y: 600, width: 420, height: 200 },
  safeBounds: () => null,
  displayForBounds: () => ({ workArea: context.area }),
  area: initialArea,
}
vm.createContext(context)
const constants = main.slice(main.indexOf('const CONTROL_COLLAPSED'), main.indexOf('const TOPMOST_LEVEL'))
vm.runInContext(constants, context)
for (const name of ['clamp', 'setControlBounds']) {
  const start = main.indexOf(`function ${name}(`)
  const end = main.indexOf('\nfunction ', start + 1)
  vm.runInContext(main.slice(start, end), context)
}
function dimensions(width, height) {
  assert.equal(context.bounds.width, width)
  assert.equal(context.bounds.height, height)
  assert(context.bounds.x >= context.area.x + 12)
  assert(context.bounds.y >= context.area.y + 12)
  assert(context.bounds.x + width <= context.area.x + context.area.width - 12)
  assert(context.bounds.y + height <= context.area.y + context.area.height - 12)
}
context.setControlBounds(false, true, false, 'join')
dimensions(360, 380)
const right = context.bounds.x + context.bounds.width
context.setControlBounds(false, false, false, 'toolbar')
dimensions(660, 64)
assert.equal(context.bounds.x + context.bounds.width, right, 'Mode switch preserves right edge')
context.setControlBounds(true)
dimensions(420, 760)
context.setControlBounds(false)
dimensions(660, 64) // Capture cancellation remembers toolbar rather than QR.
context.setControlBounds(true, false, true)
dimensions(1100, 760)
context.area = { x: -1024, y: 0, width: 1024, height: 682 }
context.setControlBounds(true)
dimensions(420, 658)
context.setControlBounds(false, false, false, 'toolbar')
dimensions(660, 64)
context.setControlBounds(false, false, false, 'toolbar', 498.2)
dimensions(499, 64)
context.setControlBounds(true)
dimensions(420, 658)
context.setControlBounds(false)
dimensions(499, 64)
for (const invalid of [NaN, Infinity, -1, '900']) {
  context.setControlBounds(false, false, false, 'toolbar', invalid)
  dimensions(499, 64)
}
context.setControlBounds(false, false, false, 'toolbar', 5000)
dimensions(1000, 64)
assert.match(main, /minHeight: 64/)

const compile = text => ts.transpileModule(text, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
} }).outputText
const page = fs.readFileSync('src/routes/PresenterPage.tsx', 'utf8')
const tree = ts.createSourceFile('PresenterPage.tsx', page, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function declaration(name) {
  let found
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.getText(tree) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert(found, name)
  return found.getText(tree)
}
const state = { joinOpen: true, controlsOpen: false, session: { current_question_id: 'current' }, selectedQuestionId: 'history' }
const calls = []
const nav = { window: { interactDesktop: { setPresenterExpanded: async (...args) => calls.push(args) } },
  session: state.session, questionFocus: { select: id => calls.push(['select', id]) },
  loadAll: async () => calls.push(['load']), logDiagnostic: () => {},
}
for (const key of ['editorOpen', 'fileTransferOpen', 'textDispatchOpen', 'settingsOpen', 'endClassConfirmOpen', 'closeConfirmOpen', 'joinOpen', 'controlsOpen', 'selectedQuestionId', 'resultsRequested']) {
  nav[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { state[key] = typeof value === 'function' ? value(state[key] || 0) : value }
}
vm.createContext(nav)
for (const name of ['returnToClassView', 'openCurrentResults']) vm.runInContext(compile(declaration(name)), nav)
nav.returnToClassView()
assert.equal(state.joinOpen, false)
assert.equal(state.controlsOpen, false)
assert.equal(state.session.current_question_id, 'current')
assert.deepEqual(calls[0], [false, false, false, 'toolbar'])
nav.openCurrentResults()
assert.equal(state.controlsOpen, true)
assert.equal(state.selectedQuestionId, 'current', 'Results must select live question after browsing history')
assert(calls.some(call => call[0] === 'select' && call[1] === 'current'))
assert(!calls.some(call => /stop|end|close/.test(String(call[0]))), 'Navigating must not stop or close the session')
nav.returnToClassView()
assert.equal(state.resultsRequested, 0, 'Returning to teaching must reset result scrolling for the next full-panel visit')

const mod = { exports: {} }
vm.runInNewContext(compile(fs.readFileSync('src/components/PresenterToolbar.tsx', 'utf8')), {
  exports: mod.exports, require, navigator: { onLine: true },
})
const props = { busy: false, onlineCount: 32, raisedCount: 2, recording: true,
  recordingStarting: false, error: '', notice: '', hasQuestion: true, submittedCount: 12,
  onCapture() {}, onJoin() {}, onResults() {}, onPanel() {}, onRoster() {}, onMinimize() {},
}
const markup = renderToStaticMarkup(React.createElement(mod.exports.PresenterToolbar, props))
assert.match(markup, /錄製中/)
assert.match(markup, /線上 32/)
assert.match(markup, /查看結果/)
assert.match(markup, /已繳交 12 人｜查看結果/)
assert.match(renderToStaticMarkup(React.createElement(mod.exports.PresenterToolbar, { ...props, submittedCount: 0 })), /已繳交 0 人｜查看結果/)
assert.match(renderToStaticMarkup(React.createElement(mod.exports.PresenterToolbar, { ...props, submittedCount: 13 })), /已繳交 13 人｜查看結果/)
const warning = renderToStaticMarkup(React.createElement(mod.exports.PresenterToolbar, { ...props, error: '截圖失敗，請重試' }))
assert.match(warning, /role="alert"/)
assert.match(warning, /截圖失敗，請重試/)
const unavailable = renderToStaticMarkup(React.createElement(mod.exports.PresenterToolbar, { ...props, busy: true, hasQuestion: false }))
assert.match(unavailable, /disabled=""[^>]*>查看結果/)
assert.match(unavailable, /處理中/)
assert.doesNotMatch(unavailable, /已繳交/)
const widthCalls = []
const layoutEffects = []
let measuredWidth = 503.2
let resizeCallback
let disconnected = false
const measuredModule = { exports: {} }
vm.runInNewContext(compile(fs.readFileSync('src/components/PresenterToolbar.tsx', 'utf8')), {
  exports: measuredModule.exports, navigator: { onLine: true }, console,
  require: name => name === 'react' ? { ...React,
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
    useRef: () => ({ current: { getBoundingClientRect: () => ({ width: measuredWidth }) } }),
    useLayoutEffect: fn => layoutEffects.push(fn), useEffect: () => {},
  } : require(name),
  window: { interactDesktop: { setPresenterExpanded: async (...args) => widthCalls.push(args) } },
  ResizeObserver: class { constructor(callback) { resizeCallback = callback } observe() {} disconnect() { disconnected = true } },
})
measuredModule.exports.PresenterToolbar(props)
const stopMeasuring = layoutEffects[0]()
assert.deepEqual(widthCalls[0], [false, false, false, 'toolbar', 514])
resizeCallback()
assert.equal(widthCalls.length, 1, 'Unchanged width must not repeatedly resize or raise the native window')
measuredWidth = 550
resizeCallback()
assert.equal(widthCalls[1][4], 560, 'Badges and warning icons must update the native width')
stopMeasuring()
measuredWidth = 600
resizeCallback()
assert.equal(widthCalls.length, 2, 'An unmounted toolbar must not collapse a newly opened panel')
assert.equal(disconnected, true)

// Render the real page with isolated hooks and inert child components to check
// that desktop surfaces are mutually exclusive and the web layout is preserved.
const stateNames = []
function collectStates(node) {
  if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name)
    && node.initializer && ts.isCallExpression(node.initializer)
    && node.initializer.expression.getText(tree) === 'useState') stateNames.push(node.name.elements[0].getText(tree))
  ts.forEachChild(node, collectStates)
}
collectStates(tree)
function renderPage(overrides, desktop = true) {
  let index = 0
  const isolatedReact = { ...React,
    useState: initial => {
      const name = stateNames[index++]
      return [Object.hasOwn(overrides, name) ? overrides[name] : typeof initial === 'function' ? initial() : initial, () => {}]
    },
    useEffect: () => {}, useRef: initial => ({ current: initial }), useMemo: fn => fn(), useCallback: fn => fn,
  }
  const exported = {}
  function isolatedRequire(name) {
    if (name === 'react') return isolatedReact
    if (name === 'react/jsx-runtime') return require(name)
    if (name === 'react-router-dom') return { useParams: () => ({ sessionId: 'fixture' }) }
    if (name === '../lib/useSessionPresence') return { useSessionPresence: () => ({ onlineParticipantIds: [] }) }
    if (name === '../lib/supabase') return { isSupabaseConfigured: false, requireSupabase: () => { throw Error('Unexpected cloud access') } }
    if (name.startsWith('../components/')) return new Proxy({}, { get: (_, component) =>
      props => props.open === false ? null : React.createElement('div', { 'data-component': component,
        ...(component === 'PresenterToolbar' ? { 'data-submitted-count': props.submittedCount } : {}) }) })
    return new Proxy({}, { get: () => () => null })
  }
  vm.runInNewContext(compile(page), { exports: exported, require: isolatedRequire,
    window: { interactDesktop: desktop ? {} : undefined }, localStorage: { getItem: () => null },
  })
  return renderToStaticMarkup(React.createElement(exported.PresenterPage))
}
const pageFixture = { session: { id: 'fixture', code: 'ABC', captions_enabled: false }, controlsOpen: false, joinOpen: false }
const compactPage = renderPage(pageFixture)
assert.match(compactPage, /data-component="PresenterToolbar"/)
assert.doesNotMatch(compactPage, /data-component="QRCodePanel"|data-component="PresenterControlPanel"/)
const submissionFixture = { ...pageFixture, session: { ...pageFixture.session, current_question_id: 'current' },
  questions: [{ id: 'current', answer_round: 2 }, { id: 'history', answer_round: 1 }],
  selectedQuestionId: 'history', question: { id: 'history', answer_round: 1 },
  submissionAnswers: [{ question_id: 'current', round: 1 }, { question_id: 'current', round: 2 },
    { question_id: 'current', round: 2 }, { question_id: 'history', round: 1 }],
}
assert.match(renderPage(submissionFixture), /data-submitted-count="2"/, 'Count only the live question and current round while browsing history')
assert.match(renderPage({ ...submissionFixture, session: { ...pageFixture.session, current_question_id: 'new' },
  questions: [{ id: 'new', answer_round: 1 }] }), /data-submitted-count="0"/, 'A newly dispatched question must not inherit the previous count')
assert.match(renderPage({ ...submissionFixture, questions: [{ id: 'current', answer_round: 3 }] }),
  /data-submitted-count="0"/, 'A new answer round starts at zero')
const joinPage = renderPage({ ...pageFixture, joinOpen: true })
assert.match(joinPage, /data-component="QRCodePanel"/)
assert.doesNotMatch(joinPage, /data-component="PresenterToolbar"|data-component="PresenterControlPanel"/)
const expandedPage = renderPage({ ...pageFixture, controlsOpen: true })
assert.match(expandedPage, /data-component="PresenterControlPanel"/)
assert.doesNotMatch(expandedPage, /data-component="PresenterToolbar"|data-component="QRCodePanel"/)
for (const flag of ['editorOpen', 'settingsOpen', 'textDispatchOpen', 'fileTransferOpen', 'selectionMode', 'closeConfirmOpen', 'endClassConfirmOpen']) {
  assert.doesNotMatch(renderPage({ ...pageFixture, [flag]: true }), /data-component="PresenterToolbar"/, `${flag} must not leave the toolbar under a dialog`)
}
const webPage = renderPage({ ...pageFixture, controlsOpen: true }, false)
assert.match(webPage, /data-component="QRCodePanel"/)
assert.match(webPage, /data-component="PresenterControlPanel"/)
assert.doesNotMatch(webPage, /data-component="PresenterToolbar"/)
console.log('PASS: toolbar/QR/panel/settings bounds, screen clamp, capture mode restore, current-result navigation, recording/error/busy controls, exclusive desktop surfaces and unchanged web view; no cloud calls')
