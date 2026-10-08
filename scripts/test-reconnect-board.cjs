const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { renderToStaticMarkup } = require('react-dom/server')
const React = require('react')

function compile(source) {
  return ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX })
}
function declaration(file, name) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found
  const visit = node => {
    if ((ts.isVariableDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.getText(source) === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert(found, `${name} exists`)
  return (ts.isVariableDeclaration(found) ? 'const ' : '') + found.getText(source)
}
function callable(file, name, context) {
  vm.createContext(context)
  vm.runInContext(compile(declaration(file, name)) + `; globalThis.call = ${name}`, context)
  return context.call
}

async function main() {
  const { exports: exportsLoader } = (() => {
    const context = { exports: {} }; vm.runInNewContext(compile(fs.readFileSync('src/lib/coalescedLoad.ts', 'utf8')), context); return context
  })()
  const reload = exportsLoader.createCoalescedLoader()
  let firstDone, secondDone, count = 0
  const first = reload(async () => { count++; await new Promise(r => { firstDone = r }) })
  const second = reload(async () => { count++; await new Promise(r => { secondDone = r }) })
  await Promise.resolve()
  firstDone(); await first
  assert.equal(count, 2)
  // The first operation has resolved even though the next refresh still waits.
  secondDone(); await second
  await assert.rejects(reload(async () => { throw new Error('offline') }), /offline/)
  await reload(async () => { count++ })
  assert.equal(count, 3)

  let sessionWrites = 0, messageWrites = 0, failed = true
  const query = { select() { return this }, eq() { return this }, gte() { return this }, order() { return this }, limit() { return this },
    single() { return this }, then(resolve) { return Promise.resolve(failed ? { data: null, error: new Error('offline') } : { data: { id: 'class' }, error: null }).then(resolve) } }
  const context = {
    useCallback: fn => fn, isSupabaseConfigured: true, sessionId: 'class', loadingRef: { current: false }, navigator: { onLine: true },
    messageCutoffRef: { current: '' }, requireSupabase: () => ({ from: () => query }),
    setSession: () => sessionWrites++, mergeMessages: () => messageWrites++,
  }
  const loadOverlay = callable('src/routes/DesktopOverlayPage.tsx', 'loadOverlay', context)
  await loadOverlay()
  assert.equal(sessionWrites, 0, 'failed read must not unmount/replay the danmaku layer')
  assert.equal(messageWrites, 0)
  assert.equal(context.loadingRef.current, false)
  failed = false; await loadOverlay()
  assert.equal(sessionWrites, 1)
  context.navigator.onLine = false; await loadOverlay()
  assert.equal(sessionWrites, 1, 'offline polling does not issue another read')

  failed = true
  let logged = 0
  const presenter = {
    ...context, navigator: { onLine: true }, selectedQuestionId: '',
    reload: { current: fn => fn() }, logDiagnostic: () => logged++,
  }
  const loadPresenter = callable('src/routes/PresenterPage.tsx', 'loadAll', presenter)
  await loadPresenter()
  assert.equal(sessionWrites, 1, 'teacher keeps the previous session on failed reads')
  assert.equal(logged, 1)

  let messages = [{ id: 'seen', created_at: '2026-10-08T01:00:00Z' }]
  const same = messages
  const mergeMessages = callable('src/routes/DesktopOverlayPage.tsx', 'mergeMessages', { useCallback: fn => fn, setMessages: fn => { messages = fn(messages) } })
  mergeMessages([{ id: 'seen', created_at: '2026-10-08T01:00:00Z' }])
  assert.equal(messages, same, 'replayed historical rows do not rebuild the animation list')
  mergeMessages([{ id: 'new', created_at: '2026-10-08T01:00:01Z' }])
  assert.equal(messages.length, 2)

  const wall = { exports: {}, require: name => {
    if (name.includes('boardCards')) return { boardFileName: () => '', isImageCard: () => false }
    if (name.includes('boardData')) return { sortedBoardPosts: posts => posts.filter(p => !p.reply_to), repliesByParent: posts => new Map([['card', posts.filter(p => p.reply_to)]]) }
    return require(name)
  } }
  vm.runInNewContext(compile(fs.readFileSync('src/components/BoardWall.tsx', 'utf8')), wall)
  const posts = [{ id: 'card', participant_name: 'Private Student', kind: 'text', body: 'answer', created_at: '' },
    { id: 'reply', reply_to: 'card', participant_name: 'Private Reply', body: 'reply' }]
  const anonymousHtml = renderToStaticMarkup(React.createElement(wall.exports.BoardWall, { anonymous: true, posts, reactions: [], onSetState: null }))
  assert(!anonymousHtml.includes('Private Student') && !anonymousHtml.includes('Private Reply'))
  const namedHtml = renderToStaticMarkup(React.createElement(wall.exports.BoardWall, { anonymous: false, posts, reactions: [], onSetState: null }))
  assert(namedHtml.includes('Private Student') && namedHtml.includes('Private Reply'))

  let revoked = 0, renderCount = 0, error = ''
  const marksRef = { current: [] }
  const imageContext = {
    busy: false, importing: false, locale: 'zh-TW', participantText: (_locale, key) => key,
    setImageError: text => { error = text }, setImporting: () => {}, importRequest: { current: 0 },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL: () => revoked++ },
    Image: class { naturalWidth = 4000; naturalHeight = 3000; async decode() {} },
    document: { createElement: () => ({ width: 0, height: 0, getContext: () => ({ drawImage: () => {} }) }) },
    CANVAS: { width: 1200, height: 800 }, nextId: { current: 1 }, marksRef, selectedRef: { current: null }, IDENTITY: {},
    setTool: () => {}, render: () => renderCount++, bump: () => {},
  }
  const importImage = callable('src/components/BoardDrawing.tsx', 'importImage', imageContext)
  await importImage({ type: 'image/jpeg', size: 5000 })
  assert.equal(marksRef.current[0].tool, 'image')
  assert.equal(marksRef.current[0].image.width, 2048)
  assert.equal(renderCount, 1)
  assert.equal(revoked, 1)
  await importImage({ type: 'image/jpeg', size: 21 * 1024 * 1024 })
  assert.equal(error, 'drawImportTooLarge')
  assert.equal(marksRef.current.length, 1, 'failed import retains previous work')

  const review = fs.readFileSync('src/routes/BoardReviewPage.tsx', 'utf8')
  assert(review.includes("select('anonymous_enabled')"))
  assert(review.includes('setAnonymous(data?.anonymous_enabled !== false)'))
  assert(review.includes("action: 'update_session', anonymousEnabled: !anonymous"))
  assert(review.includes('anonymous={anonymous}'))
  console.log('PASS: reconnect retains overlay, historical messages deduplicated, bounded snapshot waiting, card/reply anonymity and resized photo import')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
