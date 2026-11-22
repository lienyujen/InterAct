const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const compile = s => ts.transpile(s, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX })
const sid='11111111-1111-4111-8111-111111111111', pid='22222222-2222-4222-8222-222222222222', qid='33333333-3333-4333-8333-333333333333'
async function main() {
  let handler, valid=true, status='success', kind='oral_response'
  const filters=[]
  const analysis={score:0,summary:'已批改回饋',detected_language:'zh',strengths:['優點'],improvements:['建議'],transcript:'逐字稿',relevance:'相關',clarity:'清晰',completeness:'完整'}
  const response=()=>({id:'audio',participant_id:pid,question_id:qid,session_id:sid,analysis_status:status,analysis_json:status==='success'?analysis:null,score:status==='success'?0:null,error_message:'provider-private-error',storage_path:'private/path'})
  const admin={from(table){const query={select(){return this},eq(k,v){filters.push([table,k,v]);return this},async maybeSingle(){
    return {data: table==='participant_session_keys' ? valid?{participants:{id:pid,session_id:sid,name:'Me'}}:null
      : table==='questions'?{id:qid,session_id:sid,type:kind,status:'active'}:response()}
  }};return query},storage:{from:()=>({createSignedUrl:async()=>({data:null,error:{message:'playback signing failed'}})})}}
  vm.runInNewContext(compile(fs.readFileSync('supabase/functions/participant-action/index.ts','utf8')),{
    exports:{}, Request,Response,console,Deno:{serve:fn=>{handler=fn}},require:name=>name.includes('/supabase')
      ?{getAdminClient:()=>admin,hashParticipantToken:async()=> 'hash'}
      :{corsHeaders:{},jsonResponse:(data,status=200)=>Response.json(data,{status}),errorDetail:String},
  })
  const input={action:'get_recording_result',sessionId:sid,participantId:pid,participantToken:'x'.repeat(40),questionId:qid}
  const request=()=>handler({method:'POST',json:async()=>input})
  for(kind of ['oral_response','pronunciation']) {
    status='success'; const res=await request(); assert.equal(res.status,200)
    const data=(await res.json()).response
    assert.equal(data.score,0);assert.equal(data.analysis_json.summary,'已批改回饋')
    assert.equal(data.storage_path,undefined);assert.equal(data.error_message,null);assert.equal(data.signed_url,null)
    for(const [k,v] of [['session_id',sid],['question_id',qid],['participant_id',pid]]) assert.ok(filters.some(f=>f[0]==='audio_responses'&&f[1]===k&&f[2]===v))
    status='pending';assert.equal((await (await request()).json()).response.analysis_status,'pending')
    status='failed';const failure=(await (await request()).json()).response;assert.ok(!failure.error_message.includes('provider-private'))
  }
  valid=false;assert.equal((await request()).status,403)
  const exports={}
  vm.runInNewContext(compile(fs.readFileSync('src/components/AudioRecorder.tsx','utf8')), {exports,require:name=>name.includes('/audio')?{}
    :name.includes('questionTiming')?{formatSeconds:String}:name.includes('participantI18n')?{participantText:(_l,k)=>k}:require(name)})
  for(const type of ['oral_response','pronunciation']) for(status of ['success','pending','failed']) {
    const html=renderToStaticMarkup(React.createElement(exports.AudioRecorder,{question:{id:qid,type,status:'active'},response:response(),busy:false,onSubmit:async()=>{}}))
    if(status==='success') {assert.ok(html.includes('已批改回饋'));assert.ok(html.includes('優點'));assert.ok(html.includes('建議'));assert.ok(html.includes('<strong>0</strong>'))}
    else assert.ok(html.includes(status==='pending'?'assessmentPending':'assessmentFailed'))
  }
  const source=fs.readFileSync('src/routes/ParticipantPage.tsx','utf8')
  const tree=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
  let effect
  function visit(n){if(ts.isCallExpression(n)&&n.expression.getText(tree)==='useEffect'&&n.getText(tree).includes('!audioWaiting'))effect=n;ts.forEachChild(n,visit)}visit(tree)
  const pending=new Map();let seq=0,reads=0,cleanup
  const context={useEffect:fn=>{cleanup=fn()},audioWaiting:true,pageVisible:true,participantToken:'token',question:{id:qid},
    navigator:{onLine:true},loadAll:async()=>{reads++},Math:{random:()=>.5},
    setTimeout:(fn,delay)=>{assert.ok(delay>=5000);pending.set(++seq,fn);return seq},clearTimeout:id=>pending.delete(id)}
  vm.runInNewContext(compile(effect.getText(tree)),context)
  const run=pending.get(seq);pending.delete(seq);await run();assert.equal(reads,1);assert.equal(pending.size,1)
  context.navigator.onLine=false;const offline=pending.get(seq);pending.delete(seq);await offline();assert.equal(reads,1)
  cleanup();assert.equal(pending.size,0)
  console.log('PASS: both spoken types show own grade during active answering; pending/failure states, private field removal, auth/query isolation and bounded offline-safe refresh')
}
main().catch(e=>{console.error(e);process.exitCode=1})
