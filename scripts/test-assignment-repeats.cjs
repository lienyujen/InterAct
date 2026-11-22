const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { randomUUID: uuid } = require('node:crypto')
const compile = source => ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX })
function load(file) { const exports = {}; vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports }); return exports }
async function main() {
  const { pendingAssignment } = load('src/lib/assignmentProgress.ts')
  const progress = { questionId: 'q', type: 'poll', status: 'active', expectedIds: ['a', 'b', 'b'], submittedIds: ['a', 'removed'], round: 1 }
  assert.equal(pendingAssignment(progress).pending.join(), 'b')
  assert.equal(pendingAssignment({ ...progress, status: 'stopped' }).closed, true)
  for (const type of ['board', 'camera_poll', 'send_screen']) assert.equal(pendingAssignment({ ...progress, type }), null)
  const { repeatScoring } = load('src/lib/repeatScoring.ts')
  const scoring = repeatScoring([{ id: 'q1', created_at: '1' }, { id: 'q2', repeat_root_id: 'q1', created_at: '2' }])
  const rows = scoring.latest([{ question_id: 'q1', participant_id: 'a', submitted_at: '1' }, { question_id: 'q2', participant_id: 'a', submitted_at: '2' }, { question_id: 'q1', participant_id: 'b', submitted_at: '1' }])
  assert.equal(rows.length, 2); assert.equal(rows.find(r => r.participant_id === 'a').submitted_at, '2')
  assert.ok(rows.every(r => r.question_id === 'q1'))
  assert.equal(scoring.latest([{ question_id: 'q2', participant_id: 'a', submitted_at: '2' }, { question_id: 'q2', participant_id: 'a', submitted_at: '3' }]).length, 2, 'Multi-page uploads stay together')
  const { renderToStaticMarkup } = require('react-dom/server')
  function component(file, name) {
    const exports = {}; vm.runInNewContext(compile(fs.readFileSync(file, 'utf8')), { exports, require, window: {} }); return exports[name]
  }
  const Control = component('src/components/QuestionStopControl.tsx', 'QuestionStopControl')
  for (const type of ['poll','rating','multiple_choice','true_false','short_answer','pronunciation','oral_response','file_upload','drawing','hotspot','ordering','matching','board','camera_poll','custom_quiz','send_screen']) {
    for (const isCurrentQuestion of [true, false]) {
      const html = renderToStaticMarkup(require('react').createElement(Control, { question: { type, status: 'active' }, isCurrentQuestion, canRepeat: true }))
      assert.equal((html.match(/aria-label="再做一次"/g) || []).length, 1)
    }
  }
  const backend = fs.readFileSync('supabase/functions/presenter-action/index.ts', 'utf8')
  assert.ok(backend.indexOf("action === 'repeat_assignment'") > backend.indexOf('講者權限驗證失敗'))
  const presenterSource = fs.readFileSync('src/routes/PresenterPage.tsx','utf8')
  const tree = ts.createSourceFile('PresenterPage.tsx',presenterSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  let repeatNode
  function visit(node) { if (ts.isFunctionDeclaration(node) && node.name?.text==='nextRound') repeatNode=node; ts.forEachChild(node,visit) }
  visit(tree)
  for (const type of ['multiple_choice','custom_quiz','file_upload','drawing','oral_response','pronunciation','board','send_screen','camera_poll']) {
    const calls=[], state={}, question={ id:'historical', type, options:['A','B'], camera_gesture_map:['one','two'] }
    const context={ question, repeatLock:{current:false}, getPresenterToken:()=> 'token', sessionId:'session', crypto:require('node:crypto'),
      questionScreenshotUrl:'image.png', fetch:async()=>({blob:async()=>new Blob(['image'],{type:'image/png'})}), File, Blob,
      localStorage:{setItem(){}}, window:{interactDesktop:{openCameraPoll:async()=>calls.push('camera')}},
      cancelCameraPoll(){}, edgeFunctionErrorMessage:async()=> 'failed',
      requireSupabase:()=>({functions:{invoke:async(_name,{body})=>{calls.push(body);return {data:{question:{id:'fresh'}}}}}}),
      showDispatchedQuestion:q=>{state.question=q},
    }
    for(const name of ['CaptureFile','CameraPollRequest','CameraPollResult','CameraPollError','ControlsOpen']) context['set'+name]=value=>{state[name]=value}
    vm.runInNewContext(compile(repeatNode.getText(tree))+';exports.run=nextRound',{...context,exports:state})
    await state.run()
    assert.equal(context.repeatLock.current,false)
    if(type==='camera_poll') {assert.ok(calls.includes('camera'));assert.equal(state.CameraPollResult,null);assert.equal(state.CameraPollRequest.type,'camera_poll')}
    else {assert.equal(calls[0].questionId,'historical');assert.equal(calls[0].action,'repeat_assignment');assert.equal(state.question.id,'fresh')}
  }
  const sql = fs.readFileSync('supabase/migrations/20261122010831_assignment_repeats_progress.sql', 'utf8')
  assert.ok(fs.readFileSync('supabase/schema.sql', 'utf8').replaceAll('\r','').includes(sql.replaceAll('\r','').trim()))
  if (process.env.INTERACT_PGLITE) {
    const { PGlite } = require(process.env.INTERACT_PGLITE)
    const db = new PGlite()
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;')
    const schema = fs.readFileSync('supabase/schema.sql', 'utf8')
    for (const match of schema.matchAll(/create table if not exists public\.\w+ \([\s\S]*?\n\);/g)) await db.exec(match[0])
    await db.exec('alter table public.questions add column board_revealed_at timestamptz;')
    await db.exec(sql); await db.exec(sql)
    const session = uuid(), other = uuid(), a = uuid(), b = uuid(), late = uuid()
    await db.query("insert into sessions(id,title,code) values ($1,'test','test-a'),($2,'other','test-b')", [session, other])
    await db.query("insert into participants(id,session_id,name,device_id) values ($1,$3,'A','a'),($2,$3,'B','b')", [a,b,session])
    async function question(type, sid=session) { return (await db.query("insert into questions(session_id,type,title,options) values ($1,$2,'Test','[\"A\",\"B\"]') returning *", [sid,type])).rows[0] }
    async function repeat(q, request=uuid(), sid=session) { return (await db.query('select repeat_assignment($1,$2,$3) q',[sid,q.id,request])).rows[0].q }
    async function read(q) { return (await db.query('select assignment_progress($1,$2) p',[session,q.id])).rows[0].p }
    const q = await question('multiple_choice')
    assert.equal((await read(q)).expectedIds.length, 2)
    await db.query('insert into answers(session_id,question_id,participant_id,participant_name,answer_value) values ($1,$2,$3,\'A\',\'A\')',[session,q.id,a])
    await db.query("insert into participants(id,session_id,name,device_id) values ($1,$2,'Late','late')",[late,session])
    assert.equal((await read(q)).expectedIds.length, 3)
    await db.query("update participants set last_seen_at=now()-interval '5 minutes' where id=$1",[b])
    assert.equal((await read(q)).expectedIds.length, 3, 'Going offline must not erase missing work')
    const request=uuid(), fresh=await repeat(q,request)
    assert.notEqual(fresh.id,q.id); assert.equal(fresh.repeat_root_id,q.id); assert.equal(fresh.repeat_number,2)
    assert.equal((await repeat(q,request)).id,fresh.id, 'Duplicate requests must not create extra rounds')
    assert.equal((await read(fresh)).submittedIds.length,0)
    assert.equal((await db.query('select * from answers where question_id=$1',[q.id])).rows.length,1)
    await assert.rejects(repeat(q,uuid(),other),/找不到/)
    for (const type of ['poll','rating','true_false','short_answer','pronunciation','oral_response','file_upload','drawing','hotspot','ordering','matching','board','send_screen']) {
      const source=await question(type), next=await repeat(source)
      assert.equal(next.type,type); assert.equal(next.status,'active'); assert.equal(next.answer_round,1)
    }
    const quizQ=await question('custom_quiz')
    const quiz=(await db.query("insert into quizzes(session_id,question_id,title,direction,requested_type) values ($1,$2,'Quiz','English','multiple_choice') returning id",[session,quizQ.id])).rows[0]
    const item=(await db.query("insert into quiz_items(quiz_id,position,type,prompt_text,points) values ($1,1,'multiple_choice','Question?',100) returning id",[quiz.id])).rows[0]
    await db.query("insert into quiz_item_keys(item_id,accepted_answers) values ($1,array['A'])",[item.id])
    const quizNew=await repeat(quizQ)
    assert.equal((await db.query('select count(*) n from quiz_items i join quizzes q on q.id=i.quiz_id join quiz_item_keys k on k.item_id=i.id where q.question_id=$1',[quizNew.id])).rows[0].n,1)
    assert.equal((await db.query("select has_function_privilege('anon','public.repeat_assignment(uuid,uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false)
    await db.close()
    console.log('PASS: real Postgres fresh attempts for all response types, quiz/key cloning, preserved answers, duplicate protection, session isolation and audience/offline counts')
  }
  console.log('PASS: repeat icons on current/history activities, latest-attempt scoring, pending counter and presenter-only backend')
}
main().catch(error => { console.error(error); process.exitCode=1 })
