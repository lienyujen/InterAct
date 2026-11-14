const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const tree = ts.createSourceFile('PresenterPage.tsx', fs.readFileSync('src/routes/PresenterPage.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function declaration(name) {
  let found
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node
    ts.forEachChild(node, visit)
  }
  visit(tree)
  assert(found, name)
  return found.getText(tree)
}
const code = ts.transpileModule(declaration('edgeFunctionErrorMessage') + declaration('stopQuestion') + ';globalThis.stop=stopQuestion', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
async function run({ failure, selectedId = 'oral', token = 'test-token' } = {}) {
  const stopped = { id: 'oral', type: 'oral_response', status: 'stopped' }
  const state = { selected: { id: selectedId, status: 'active' }, questions: [{ id: 'oral', status: 'active' }], reloads: 0, requests: 0 }
  const context = { Error, Response, session: { current_question_id: 'oral' }, sessionId: 'session',
    getPresenterToken: () => token,
    requireSupabase: () => ({ functions: { invoke: async (name, { body }) => {
      state.requests++
      assert.equal(name, 'presenter-action')
      assert.equal(body.action, 'stop_question')
      assert.equal(body.questionId, 'oral')
      return failure ? { error: failure } : { data: { question: stopped } }
    } } }),
    setQuestions: update => { state.questions = update(state.questions) },
    setQuestion: update => { state.selected = update(state.selected) },
    loadAll: async () => { state.reloads++ },
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  return { state, stop: context.stop }
}
async function main() {
  const success = await run()
  await success.stop()
  assert.equal(success.state.selected.status, 'stopped', 'Success must update the visible question without a realtime notification')
  assert.equal(success.state.questions[0].status, 'stopped')
  assert.equal(success.state.reloads, 1, 'Reload must fetch recording results after stopping')
  const history = await run({ selectedId: 'history' })
  await history.stop()
  assert.equal(history.state.selected.id, 'history', 'A late stop response must not replace another selected question')
  for (const [status, message] of [[409, '題目已停止或不存在。'], [403, '講者權限不足。']]) {
    const failure = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      context: new Response(JSON.stringify({ message }), { status }),
    })
    const failed = await run({ failure })
    await assert.rejects(failed.stop, { message })
    assert.equal(failed.state.reloads, 1, 'Failure must refresh stale state, including an already-stopped question')
    assert.equal(failed.state.selected.status, 'active', 'Failure must not invent a successful stop')
    assert.equal(failed.state.requests, 1, 'Do not retry mutations automatically')
  }
  const denied = await run({ token: '' })
  await assert.rejects(denied.stop, /找不到講者權限/)
  assert.equal(denied.state.requests, 0)
  console.log('PASS: stop updates without realtime, refreshes recordings and conflicts, preserves selection, reports backend reasons and guards credentials; no network or AI')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
