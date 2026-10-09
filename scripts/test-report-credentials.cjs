const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const path = require('node:path')
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
const compile = source => ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })

function frontend(token, ownerKey) {
  const context = { exports: {}, window: { localStorage: { getItem: () => token } }, require: () => ({ getOwnerKey: () => ownerKey }) }
  vm.runInNewContext(compile(read('src/lib/presenterAuth.ts')), context)
  return context.exports.getReportCredentials('old-session')
}
assert.equal(frontend(null, 'owner').ownerKey, 'owner')
assert.equal(frontend('token', '').presenterToken, 'token')
assert.equal(frontend('stale-token', 'owner').ownerKey, 'owner')
assert.throws(() => frontend(null, ''), /管理金鑰/)

// Exercise the SDK wrapper, not just its allowlist: a fresh FunctionsClient
// getter must carry the owner's key to analysis, but never to student calls.
const calls = []
class Functions { invoke(name, options) { calls.push({ name, body: options.body }) } }
const sdkContext = { exports: {}, FormData, URL,
  buildEnv: { VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co', VITE_SUPABASE_ANON_KEY: 'public-fixture' },
  window: { location: { hash: '' }, localStorage: { getItem: () => null } },
  require: name => name === '@supabase/supabase-js' ? { createClient: () => ({ get functions() { return new Functions() } }) }
    : { getOwnerKey: () => 'owner-fixture', guardRealtimeTables: client => client, boundedFetch: () => {} },
}
vm.runInNewContext(compile(read('src/lib/supabase.ts').replaceAll('import.meta.env', 'globalThis.buildEnv')), sdkContext)
sdkContext.exports.requireSupabase().functions.invoke('analyze-session', { body: { sessionId: 'old-session' } })
sdkContext.exports.requireSupabase().functions.invoke('participant-action', { body: { sessionId: 'old-session' } })
assert.equal(calls[0].body.ownerKey, 'owner-fixture')
assert.equal(calls[1].body.ownerKey, undefined)

async function backend(input, expectedOwner, validToken = false) {
  let handler
  const tables = []
  const ownerContext = { exports: {}, Deno: { env: { get: () => expectedOwner } }, TextEncoder }
  vm.runInNewContext(compile(read('supabase/functions/_shared/owner.ts')), ownerContext)
  const query = { select() { return this }, eq() { return this },
    maybeSingle: async () => ({ data: validToken ? { session_id: 'old-session' } : null }),
    single: async () => ({ data: null }) }
  const context = { exports: {}, Response, console,
    Deno: { serve: fn => { handler = fn } },
    require: name => name.includes('/owner') ? ownerContext.exports : name.includes('/supabase') ? {
      getAdminClient: () => ({ from: table => { tables.push(table); return query } }),
      hashPresenterToken: async token => token,
    } : { corsHeaders: {}, parseThinkingLevel: () => undefined,
      jsonResponse: (body, status = 200) => Response.json(body, { status }),
      callAiJson: () => { throw new Error('Authorization tests must never call paid AI') },
    },
  }
  vm.runInNewContext(compile(read('supabase/functions/analyze-session/index.ts')), context)
  const response = await handler({ method: 'POST', json: async () => input })
  return { status: response.status, tables }
}

async function main() {
  // A nonexistent fixture session stops authorized requests at 404 before AI
  // or any writes. Unauthorized callers must stop at 403 before session reads.
  for (const input of [
    { sessionId: 'old-session', ownerKey: 'correct' },
    { sessionId: 'old-session', ownerKey: 'correct', presenterToken: 'stale' },
  ]) {
    const result = await backend(input, 'correct')
    assert.equal(result.status, 404)
    assert.deepEqual(result.tables, ['sessions'])
  }
  for (const input of [
    { sessionId: 'old-session' },
    { sessionId: 'old-session', ownerKey: 'wrong' },
    { sessionId: 'old-session', presenterToken: 'bad' },
  ]) {
    const result = await backend(input, 'correct')
    assert.equal(result.status, 403)
    assert.equal(result.tables.includes('sessions'), false)
  }
  assert.equal((await backend({ sessionId: 'old-session', presenterToken: 'valid' }, '', true)).status, 404)
  assert.equal((await backend({ sessionId: 'old-session', ownerKey: 'anything' }, '')).status, 403)
  assert.equal((await backend({ ownerKey: 'correct' }, 'correct')).status, 400)

  const page = read('src/routes/SessionReportPage.tsx')
  assert.equal((page.match(/getReportCredentials\(sessionId\)/g) || []).length, 2)
  assert.equal(page.includes('getPresenterToken'), false)
  assert.match(read('src/lib/presenterSessions.ts'), /!credentials.length && !hasOwnerKey\(\)/)
  assert.match(read('src/lib/supabase.ts'), /ownerFunctions = new Set\([^\n]*'analyze-session'/)
  console.log('PASS: historical report owner access, token compatibility, missing/wrong-key rejection, no paid AI calls')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
