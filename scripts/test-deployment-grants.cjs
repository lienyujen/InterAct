const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const schema = fs.readFileSync('supabase/schema.sql', 'utf8')
const tables = [...schema.matchAll(/create table if not exists public\.(\w+)/g)].map(m => m[1])
const grant = schema.match(/grant select, insert, update, delete on table\s+([\s\S]*?) to service_role;/)[0]
for (const table of tables) assert.ok(grant.includes(`public.${table}`), `${table} needs explicit server grants`)
assert.ok(!/\ball tables\b/i.test(grant), 'Do not grant access to unrelated application tables')
assert.ok(!/to anon|to authenticated|disable row level security/i.test(grant))

let source = fs.readFileSync('src/lib/backendDeploy.ts', 'utf8')
source = source.replace(/import\.meta\.glob\([\s\S]*?\)/g, '({})')
const code = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
async function verify(missing) {
  const calls = []
  const context = { exports: {}, require: () => ({}), window: { interactDesktop: {
    supabaseManagement: async request => {
      calls.push(request)
      return { ok: true, body: JSON.stringify([{ tables: 6, buckets: 3, columns: 7, routines: 2, missing_grants: missing }]) }
    },
  } } }
  vm.runInNewContext(code, context)
  await context.exports.verifyBackend('test', 'not-a-secret')
  assert.ok(calls.some(c => c.json?.query?.includes('has_table_privilege')))
}
async function main() {
  await verify([])
  await assert.rejects(verify(['sessions']), /缺少後端存取權限.*sessions/)
  await assert.rejects(verify(undefined), /無法確認/)
  // Optional real Postgres/WASM test, installed outside the repository.
  if (process.env.INTERACT_PGLITE) {
    const { PGlite } = require(process.env.INTERACT_PGLITE)
    const db = new PGlite()
    await db.exec('create role service_role bypassrls; create role anon; create role authenticated;')
    for (const table of tables) await db.exec(`create table public.${table}(id int); alter table public.${table} enable row level security;`)
    await db.exec('insert into public.sessions values (42);')
    await db.exec('set role service_role;')
    await assert.rejects(db.query('select * from public.sessions'), /permission denied/)
    await db.exec('reset role;')
    const permissionQuery = 'select' + source.match(/`select([\s\S]*?as missing_grants),/)[1]
    assert.equal((await db.query(permissionQuery)).rows[0].missing_grants.length, tables.length)
    await db.exec(grant)
    await db.exec(grant) // Existing deployments can safely rerun it.
    assert.deepEqual((await db.query(permissionQuery)).rows[0].missing_grants, [])
    await db.exec('set role service_role;')
    assert.equal((await db.query('select * from public.sessions')).rows[0].id, 42)
    await db.exec('insert into public.sessions values (43); update public.sessions set id=44 where id=43; delete from public.sessions where id=44; reset role;')
    assert.equal((await db.query("select has_table_privilege('anon','public.sessions','INSERT') as allowed")).rows[0].allowed, false)
    await db.close()
    console.log('Real Postgres: denied before grant; CRUD succeeds after grant; rerun preserves data; anonymous writes stay denied.')
  }
  console.log('Deployment grant coverage and verification tests passed.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
