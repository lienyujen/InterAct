const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(path.join(__dirname, '../src/lib/supabase.ts'), 'utf8').replaceAll('import.meta.env', 'globalThis.buildEnv')
const code = ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 })
const usb = { ref: 'abcdefghijklmnopqrst', key: 'sb_publishable_usb_public_key', appUrl: 'https://example.com/usb' }
const host = { ref: 'tsrqponmlkjihgfedcba', key: 'sb_publishable_host_public_key' }

function load(portable, writeResult = { ok: true }) {
  const stored = new Map([['interact:backend', JSON.stringify(host)]])
  const writes = []
  class Functions { invoke() {} }
  const context = {
    exports: {}, buildEnv: {}, FormData,
    window: {
      location: { hash: '' },
      localStorage: { getItem: key => stored.get(key), setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) },
      ...(portable ? { interactDesktop: {
        getPortableBackendConfig: () => portable,
        savePortableBackendConfig: input => { writes.push(input); return writeResult },
      } } : {}),
    },
    require: name => name === '@supabase/supabase-js'
      ? { createClient: () => ({ functions: new Functions() }) } : { getOwnerKey: () => '', guardRealtimeTables: client => client, boundedFetch: () => {} },
  }
  vm.createContext(context)
  vm.runInContext(code, context)
  return { api: context.exports, stored, writes }
}

const runtime = load({ ok: true, hasFile: true, config: usb })
assert.equal(runtime.api.backendConfig.ref, usb.ref, 'USB settings must beat the host computer settings')
assert.equal(runtime.api.saveBackendConfig(usb).ok, true)
assert.equal(runtime.writes[0].key, usb.key)
assert.equal(runtime.api.clearBackendConfig().ok, true)
assert.equal(runtime.writes[1].ref, '')
assert.equal(runtime.stored.has('interact:backend'), false)
assert.equal(load({ ok: true, hasFile: true, config: null }).api.backendConfig, null)
assert.equal(load({ ok: false, hasFile: true, message: 'Invalid file' }).api.backendConfig, null)
assert.equal(load({ ok: true, hasFile: false, config: null }).api.backendConfig.ref, host.ref)
assert.equal(load(null).api.backendConfig.ref, host.ref, 'Browser-only behavior must remain unchanged')
const failure = load({ ok: true, hasFile: true, config: usb }, { ok: false, message: 'Drive is read-only' })
assert.equal(failure.api.saveBackendConfig(usb).ok, false)
assert.equal(JSON.parse(failure.stored.get('interact:backend')).ref, host.ref, 'Failed writes must not change the host settings')
assert.equal(failure.api.clearBackendConfig().ok, false)
console.log('PASS: renderer prioritizes USB, persists before reload, prevents stale fallback and reports write errors')
