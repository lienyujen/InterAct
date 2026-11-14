// Run with: pnpm exec electron scripts/test-presenter-toolbar-layout.cjs
// Render the actual toolbar and CSS with fixture data, without a classroom.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const root = path.join(__dirname, '..')
const work = path.join(root, '.codex-tmp', 'toolbar-layout')
const output = path.join(work, 'results')
fs.mkdirSync(work, { recursive: true })
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', path.join(work, 'profile'))
app.on('window-all-closed', () => {})
let phase = 'starting'
app.whenReady().then(async () => {
  const mod = { exports: {} }
  const source = fs.readFileSync(path.join(root, 'src/components/PresenterToolbar.tsx'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const state = { online: true }
  vm.runInNewContext(compiled, { exports: mod.exports, require, navigator: { get onLine() { return state.online } } })
  const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8')
  const cases = [
    ['normal', { notice: '題目已派送' }],
    ['raised', { onlineCount: 999, raisedCount: 99, submittedCount: 999 }],
    ['no-question', { hasQuestion: false }],
    ['warning', { error: '測試用錯誤提示' }],
    ['offline', { offline: true }],
    ['recording', { recordingStarting: true }],
    ['long-status', { notice: '這是一段很長的狀態文字，不應撐大拖曳區' }],
  ]
  const results = []
  for (const [name, overrides] of cases) {
    phase = name + ':render'
    state.online = !overrides.offline
    const props = { busy: false, onlineCount: 32, raisedCount: 0, recording: false, recordingStarting: false,
      error: '', notice: '', hasQuestion: true, submittedCount: 12, onCapture() {}, onJoin() {}, onResults() {}, onPanel() {}, onRoster() {}, onMinimize() {}, ...overrides }
    const html = '<!doctype html><meta charset="utf-8"><style>' + css + '</style><div class="desktop-shell"><main class="presenter-page desktop-presenter">'
      + renderToStaticMarkup(React.createElement(mod.exports.PresenterToolbar, props)) + '</main></div>'
    const file = path.join(work, name + '.html')
    fs.writeFileSync(file, html)
    const win = new BrowserWindow({ width: 660, height: 64, show: false, frame: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
    await win.loadFile(file)
    phase = name + ':measure'
    const ready = await win.webContents.executeJavaScript("({state:document.readyState, toolbar:!!document.querySelector('.presenter-toolbar')})")
    assert(ready.toolbar, JSON.stringify({ phase, ready }))
    const width = await win.webContents.executeJavaScript("Math.ceil(document.querySelector('.presenter-toolbar').getBoundingClientRect().width) + 10")
    win.setBounds({ width, height: 64 })
    phase = name + ':metrics'
    const metrics = await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => {
      const row = document.querySelector('.presenter-toolbar').getBoundingClientRect();
      const drag = document.querySelector('.presenter-toolbar-drag').getBoundingClientRect();
      const buttons = [...document.querySelectorAll('.presenter-toolbar button')].map(b => {
        const r = b.getBoundingClientRect(); return { left:r.left, right:r.right, height:r.height, bottom:r.bottom };
      });
      resolve({ rowWidth:row.width, rowRight:row.right, dragWidth:drag.width,
        gapAfterDrag:buttons[0].left-drag.right, viewportWidth:innerWidth, viewportHeight:innerHeight, buttons });
    }))`)
    assert.equal(metrics.dragWidth, 82, `${name}: drag region must not stretch`)
    assert(metrics.gapAfterDrag <= 5, `${name}: blank space before online count`)
    assert(Math.abs(metrics.viewportWidth - (metrics.rowRight + 5)) <= 1, `${name}: native window must fit content`)
    assert(metrics.buttons.every(b => b.height >= 44 && b.bottom <= metrics.viewportHeight - 4 && b.right <= metrics.viewportWidth - 4), `${name}: buttons must remain visible and clickable`)
    assert(width < 660, `${name}: toolbar must be narrower than the old window`)
    if (name === 'normal' || name === 'warning') fs.writeFileSync(path.join(output, name + '.png'), (await win.webContents.capturePage()).toPNG())
    results.push({ case: name, width, height:64, dragWidth:metrics.dragWidth, gapAfterDrag:metrics.gapAfterDrag, passed:true })
    win.destroy()
  }
  fs.writeFileSync(path.join(output, 'layout-results.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results))
  app.quit()
}).catch(error => { fs.writeFileSync(path.join(output, 'failure.txt'), phase + '\n' + String(error?.stack || error)); console.error(error); app.exit(1) })
