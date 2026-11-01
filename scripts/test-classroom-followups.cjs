const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
function load(file, globals = {}) { const exports = {}; vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, require, ...globals }); return exports }
function declaration(file, name) {
  const tree = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let found
  function visit(node) { if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name) found = node; ts.forEachChild(node, visit) }
  visit(tree); assert(found, name)
  return (ts.isVariableDeclaration(found) ? 'const ' : '') + found.getText(tree)
}
function walk(element, predicate) {
  if (!element) return null
  if (Array.isArray(element)) { for (const item of element) { const found = walk(item, predicate); if (found) return found }; return null }
  if (predicate(element)) return element
  return element.props ? walk(element.props.children, predicate) : null
}
async function audioCase(answerSeconds) {
  const slots = [], pending = [], revoked = []
  let cursor = 0, now = 0, submitted = 0, stopped
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value }] },
    useRef(initial) { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i] },
    useEffect(fn, deps) { const i = cursor++; const previous = slots[i]; if (!previous || deps.some((value, at) => value !== previous.deps[at])) { pending.push(() => { previous?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) } },
  }
  class Recorder {
    static isTypeSupported() { return true }
    mimeType = 'audio/webm'; state = 'inactive'
    start() { this.state = 'recording' }
    stop() { this.state = 'inactive'; this.ondataavailable({ data: new Blob(['audio']) }); stopped = this.onstop() }
  }
  class TestDate extends Date { static now() { return now } }
  const api = load('src/components/AudioRecorder.tsx', { Date: TestDate, Blob, File, MediaRecorder: Recorder,
    navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) } },
    window: { setInterval: () => 1, clearInterval() {} }, URL: { createObjectURL: () => 'blob:preview', revokeObjectURL: url => revoked.push(url) },
    require: name => name === 'react' ? hooks : name.includes('/audio') ? { recordingToWav: async () => new Blob(['wav']) }
      : name.includes('questionTiming') ? { formatSeconds: String } : name.includes('participantI18n') ? { participantText: (_locale, key) => key } : require(name),
  })
  const props = { question: { id: 'q', type: 'oral_response', status: 'active', answer_seconds: answerSeconds, prepare_seconds: null }, busy: false, response: null,
    onSubmit: async () => { submitted++ } }
  const render = () => { cursor = 0; const result = api.AudioRecorder(props); while (pending.length) pending.shift()(); return result }
  render()
  await walk(render(), e => e.type === 'button' && e.props.className === 'recording-button').props.onClick()
  now = 1200
  walk(render(), e => e.type === 'button' && e.props.className?.includes('recording-button')).props.onClick()
  await stopped
  let view = render(); view = render()
  if (answerSeconds) { assert.equal(submitted, 1, 'Timed work keeps automatic submission'); return }
  assert.equal(submitted, 0, 'Untimed work stays local after stopping')
  assert(walk(view, e => e.type === 'audio' && e.props.src === 'blob:preview'), 'A real preview player is present')
  const confirm = walk(view, e => e.type === 'button' && e.props.children?.includes?.('確認送出'))
  assert(confirm); await confirm.props.onClick(); assert.equal(submitted, 1)
  props.question = { ...props.question, id: 'next' }; render(); render()
  assert(revoked.includes('blob:preview'), 'Changing questions releases the local recording URL')
}
async function main() {
  const { captureCrop } = load('src/lib/captureGeometry.ts')
  const crop = captureCrop({ x: 100, y: 50, width: 300, height: 200 }, { width: 1440, height: 875 },
    { x: 0, y: 25, width: 1440, height: 875 }, { x: 0, y: 0, width: 1440, height: 900 }, { width: 2880, height: 1800 })
  assert.equal(crop.x, 200); assert.equal(crop.y, 150); assert.equal(crop.width, 600); assert.equal(crop.height, 400)
  const external = captureCrop({ x: 100, y: 50, width: 300, height: 200 }, { width: 1440, height: 875 },
    { x: -1440, y: 25, width: 1440, height: 875 }, { x: -1440, y: 0, width: 1440, height: 900 }, { width: 2880, height: 1800 })
  assert.equal(external.y, crop.y); assert.equal(external.x, crop.x)
  const zoomed = captureCrop({ x: 100, y: 50, width: 300, height: 200 }, { width: 720, height: 437.5 },
    { x: 0, y: 25, width: 1440, height: 875 }, { x: 0, y: 0, width: 1440, height: 900 }, { width: 2880, height: 1800 })
  assert.equal(zoomed.x, 400); assert.equal(zoomed.y, 250)
  assert.throws(() => captureCrop({ x: 1, y: 1, width: 0, height: 2 }, { width: 0, height: 2 }, { x: 0, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 1, height: 1 }, { width: 2, height: 2 }))
  assert(fs.readFileSync('electron/main.cjs', 'utf8').includes('getContentBounds()'))

  const { optionCandidates } = load('src/lib/optionCandidates.ts')
  const answers = [{ participant_id: 'a', round: 1, answer_value: 'A' }, { participant_id: 'a', round: 2, answer_values: ['A', 'B'] }, { participant_id: 'b', round: 2, answer_value: 'B' }, { participant_id: 'offline', round: 2, answer_value: 'A' }]
  const participants = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'removed', removed_at: 'now' }]
  assert.deepEqual(Array.from(optionCandidates(answers, participants, 2, 'A')), ['a'])
  assert.deepEqual(Array.from(optionCandidates(answers, participants, 2, 'B')), ['a', 'b'])
  assert.deepEqual(Array.from(optionCandidates(answers, participants, 2)), ['c'])
  assert.deepEqual(Array.from(optionCandidates(answers, participants, 1)), ['b', 'c'])

  const { quizItemStats } = load('src/lib/quizItemStats.ts')
  const results = { items: [{ id: 'item', points: 20, type: 'multiple_choice', options: ['A', 'B'], prompt_text: '題目' }], keys: [],
    attempts: ['graded', 'graded', 'grading', 'graded'].map((status, i) => ({ id: `attempt${i}`, participant_id: `p${i}`, participant_name: `PrivateName${i}`, status })),
    answers: [20, 10, null].map((score, i) => ({ attempt_id: `attempt${i}`, item_id: 'item', score })) }
  const stats = quizItemStats(results, 'item')
  assert.equal(stats.correct, 1); assert.equal(stats.wrong.length, 1); assert.equal(stats.pending, 1); assert.equal(stats.missing, 1)
  const quizModule = load('src/components/CustomQuizResult.tsx', { require: name => name.includes('quizItemStats') ? { quizItemStats } : name.includes('QuestionStopControl') ? {} : require(name) })
  const html = renderToStaticMarkup(React.createElement(quizModule.QuizAnswerEditor, { results, draftAnswers: {}, busyItemId: '', showAnswers: false, onUpdateAnswer() {}, onDraftChange() {} }))
  assert(html.includes('匿名學員 2')); assert(!html.includes('PrivateName1')); assert(html.includes('答錯／未滿分'))
  const named = renderToStaticMarkup(React.createElement(quizModule.QuizAnswerEditor, { results, draftAnswers: {}, busyItemId: '', showAnswers: false, anonymousEnabled: false, onUpdateAnswer() {}, onDraftChange() {} }))
  assert(named.includes('PrivateName1'))

  await audioCase(null); await audioCase(30)
  // Exercise the actual privacy-scoped student endpoint with no network writes.
  let handler, valid = true
  const filters = []
  load('supabase/functions/participant-action/index.ts', { Request, Response, console, Deno: { serve: fn => { handler = fn } },
    require: name => name.includes('/supabase') ? { getAdminClient: () => ({ from(table) {
      const query = { select() { return this }, eq(key, value) { filters.push([table, key, value]); return this }, order() { return this },
        maybeSingle: async () => ({ data: valid ? { participants: { id: '22222222-2222-4222-8222-222222222222', session_id: '11111111-1111-4111-8111-111111111111' } } : null }),
        then: resolve => Promise.resolve({ data: [{ id: 'file', analysis_status: 'success', analysis_json: { score: 80, summary_zh_tw: '回饋' }, error_message: 'private' }], error: null }).then(resolve) }
      return query
    } }), hashParticipantToken: async () => 'hash' }
      : { corsHeaders: {}, jsonResponse: (data, status = 200) => Response.json(data, { status }), errorDetail: String },
  })
  const input = { action: 'get_file_result', sessionId: '11111111-1111-4111-8111-111111111111', participantId: '22222222-2222-4222-8222-222222222222', participantToken: 'x'.repeat(40), questionId: '33333333-3333-4333-8333-333333333333' }
  const response = await handler({ method: 'POST', json: async () => input })
  assert.equal(response.status, 200)
  const payload = await response.json(); assert.equal(payload.responses[0].analysis_json.score, 80); assert.equal(payload.responses[0].error_message, undefined)
  assert(filters.some(([table, key, value]) => table === 'file_responses' && key === 'participant_id' && value === input.participantId))
  valid = false; assert.equal((await handler({ method: 'POST', json: async () => input })).status, 403)
  const markModule = { exports: {}, require, participantText: (_locale, key) => key }
  vm.runInNewContext(compile(declaration('src/components/ParticipantFilePanel.tsx', 'verdictLabels') + declaration('src/components/ParticipantFilePanel.tsx', 'StudentMarks') + ';exports.StudentMarks=StudentMarks'), markModule)
  const markHtml = renderToStaticMarkup(React.createElement(markModule.exports.StudentMarks, { locale: 'en', marks: [{ analysis_status: 'success', analysis_json: { score: 0, summary_zh_tw: '需要補強' } }] }))
  assert(markHtml.includes('需要補強')); assert(markHtml.includes('>0'), 'A zero mark is still a real grade and must be displayed')
  const fileText = fs.readFileSync('src/components/ParticipantFilePanel.tsx', 'utf8')
  assert(fileText.includes('if (loadError || !Array.isArray(data?.responses)) throw'))
  assert(fileText.includes("filter: `participant_id=eq.${participantId}`"), 'Result refresh events are scoped to one student, not the whole class')
  assert(!declaration('src/routes/ParticipantPage.tsx', 'loadHistoryDetails').includes("if (known.some"), 'A cached old mark must not prevent reloading a regraded assignment')
  console.log('PASS: Retina/menu-bar/external-screen crop, untimed preview/timed submission, round/choice lottery, per-item grading/anonymity, own-file score/feedback and access denial; no paid APIs')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
