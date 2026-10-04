const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { configDirectory, readConfig, writeConfig } = require('../electron/portableConfig.cjs')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'interact-portable-test-'))
const first = path.join(root, 'first-computer')
const second = path.join(root, 'second-computer')
fs.mkdirSync(first)
const config = { ref: 'abcdefghijklmnopqrst', key: 'sb_publishable_test_public_key', appUrl: 'https://example.com/InterAct' }
try {
  assert.equal(readConfig(first).hasFile, false)
  fs.writeFileSync(path.join(first, '.env'), [
    `VITE_SUPABASE_URL="https://${config.ref}.supabase.co"`,
    `export VITE_SUPABASE_ANON_KEY='${config.key}'`,
    `VITE_PUBLIC_APP_URL=${config.appUrl} # public URL`,
    'OPENAI_API_KEY=never-export-this', 'GEMINI_API_KEY=never-export-this',
    'SUPABASE_ACCESS_TOKEN=never-export-this', 'OWNER_KEY=never-export-this',
  ].join('\n'))
  const env = readConfig(first)
  assert.equal(env.source, 'env')
  assert.deepEqual(env.config, config)
  assert.ok(!JSON.stringify(env).includes('never-export-this'))

  assert.equal(writeConfig(first, { ...config, ownerKey: 'never-export-this', apiKey: 'never-export-this' }).ok, true)
  assert.equal(readConfig(first).source, 'json')
  assert.deepEqual(readConfig(first).config, config)
  assert.ok(!fs.readFileSync(path.join(first, 'InterAct.config.json'), 'utf8').includes('never-export-this'))
  fs.cpSync(first, second, { recursive: true })
  assert.deepEqual(readConfig(second).config, config, 'Moving the folder keeps the same backend')

  assert.equal(writeConfig(first, { ...config, key: 'sb_secret_not_allowed' }).ok, false)
  assert.deepEqual(readConfig(first).config, config, 'Invalid input must preserve the previous settings')
  assert.equal(writeConfig(first, { ...config, appUrl: 'https://user:password@example.com' }).ok, false)
  assert.equal(writeConfig(path.join(root, 'missing'), config).ok, false, 'Unwritable folder reports failure without elevation')

  assert.equal(writeConfig(first, { ref: '', key: '' }).ok, true)
  assert.equal(readConfig(first).hasFile, true)
  assert.equal(readConfig(first).config, null, 'Clearing JSON must not revive the older .env')
  fs.writeFileSync(path.join(first, 'InterAct.config.json'), '{broken json')
  assert.equal(readConfig(first).ok, false, 'Bad JSON must not silently use a different backend')
  fs.writeFileSync(path.join(first, 'InterAct.config.json'), ' '.repeat(33000))
  assert.equal(readConfig(first).ok, false)

  assert.equal(configDirectory({ packaged: true, platform: 'win32', executablePath: path.join(second, 'InterAct.exe') }), second)
  assert.equal(configDirectory({ packaged: false, platform: 'win32', executablePath: 'ignored', appPath: root }), root)
  if (process.platform !== 'win32') assert.equal(configDirectory({ packaged: true, platform: 'darwin', executablePath: '/Volumes/USB/InterAct.app/Contents/MacOS/InterAct' }), '/Volumes/USB')
  console.log('PASS: USB moves, .env allowlist, JSON precedence, save/clear, invalid files, secret rejection and write failures')
} finally {
  // Only remove the directory this test created under the OS temporary folder.
  assert.ok(root.startsWith(path.join(os.tmpdir(), 'interact-portable-test-')))
  fs.rmSync(root, { recursive: true, force: true })
}
