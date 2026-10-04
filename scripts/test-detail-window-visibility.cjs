// Regression: delayed presenter expansion must not reveal the main window
// while a camera/quiz detail window is open. No Electron UI or API cost needed.
const fs = require('node:fs')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '../electron/main.cjs'), 'utf8')
const calls = []
const mainWindow = {
  isDestroyed: () => false,
  isMinimized: () => true,
  isVisible: () => true,
  restore: () => calls.push('restore'),
  show: () => calls.push('show'),
  showInactive: () => calls.push('showInactive'),
  moveTop: () => calls.push('moveTop'),
  focus: () => calls.push('focus'),
  setAlwaysOnTop: () => calls.push('topmost'),
}
const context = {
  mainWindow, reportWindow: null,
  quizReviewWindow: { isDestroyed: () => false },
  presenterTopmostEnabled: true, TOPMOST_LEVEL: 'floating', CONTROL_RELATIVE_LEVEL: 1,
}
vm.createContext(context)
for (const name of ['reinforcePresenterTopmost', 'bringControlToFront']) {
  const start = source.indexOf(`function ${name}(`)
  assert.ok(start >= 0)
  const end = source.indexOf('\nfunction ', start + 1)
  vm.runInContext(source.slice(start, end), context)
}
context.bringControlToFront(false)
context.bringControlToFront(true)
context.reinforcePresenterTopmost()
assert.deepEqual(calls, [], 'An open detail window must suppress delayed show and topmost calls')

context.quizReviewWindow = { isDestroyed: () => true }
context.bringControlToFront(false)
assert.deepEqual(calls, ['restore', 'showInactive', 'moveTop'])
calls.length = 0
context.quizReviewWindow = null
context.bringControlToFront(true)
assert.deepEqual(calls, ['restore', 'show', 'moveTop', 'focus'])
calls.length = 0
context.reportWindow = {}
context.bringControlToFront(true)
assert.deepEqual(calls, [], 'Report window behavior must remain unchanged')
console.log('PASS: detail window hides presenter; closing restores it; report behavior preserved')
