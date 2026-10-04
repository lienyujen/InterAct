const fs = require('node:fs')
const path = require('node:path')

const FILE_NAME = 'InterAct.config.json'
const MAX_BYTES = 32 * 1024

function configDirectory({ packaged, platform, executablePath, appPath }) {
  if (!packaged) return appPath
  if (platform === 'darwin') {
    const boundary = executablePath.indexOf('.app/Contents/')
    if (boundary >= 0) return path.dirname(executablePath.slice(0, boundary + 4))
  }
  return path.dirname(executablePath)
}

function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('設定檔格式不正確。')
  const ref = String(input.ref || input.url || '').trim().replace(/^https:\/\//, '').replace(/\.supabase\.co\/?$/, '')
  const key = String(input.key || '').trim()
  const appUrl = String(input.appUrl || '').trim().replace(/\/$/, '')
  if (!ref && !key && !appUrl) return null
  if (!/^[a-z0-9]{20}$/.test(ref)) throw new Error('專案識別碼必須為 20 個小寫英數字。')
  if (!/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) throw new Error('只能使用公開的 Supabase publishable key，不可使用私密金鑰。')
  if (appUrl) {
    let url
    try { url = new URL(appUrl) } catch { throw new Error('學員端網址格式不正確。') }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('學員端網址必須是沒有帳號密碼的 HTTPS 網址。')
  }
  // Explicit allowlist: never copy API keys, access tokens, or owner keys.
  return { ref, key, ...(appUrl ? { appUrl } : {}) }
}

function readText(file) {
  if (fs.statSync(file).size > MAX_BYTES) throw new Error('設定檔太大，請只保留後端連線欄位。')
  return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
}

function readEnv(text) {
  const values = {}
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?(VITE_SUPABASE_URL|VITE_SUPABASE_ANON_KEY|VITE_PUBLIC_APP_URL)\s*=\s*(.*)$/)
    if (!match) continue
    let value = match[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    else value = value.replace(/\s+#.*$/, '').trim()
    values[match[1]] = value
  }
  return normalize({ url: values.VITE_SUPABASE_URL, key: values.VITE_SUPABASE_ANON_KEY, appUrl: values.VITE_PUBLIC_APP_URL })
}

function readConfig(directory) {
  const file = path.join(directory, FILE_NAME)
  try {
    if (fs.existsSync(file)) return { ok: true, path: file, hasFile: true, source: 'json', config: normalize(JSON.parse(readText(file))) }
    const envFile = path.join(directory, '.env')
    if (fs.existsSync(envFile)) return { ok: true, path: file, hasFile: true, source: 'env', config: readEnv(readText(envFile)) }
    return { ok: true, path: file, hasFile: false, source: null, config: null }
  } catch (error) {
    return { ok: false, path: file, hasFile: true, message: `無法讀取程式旁的設定檔：${error.message}` }
  }
}

function writeConfig(directory, input) {
  const file = path.join(directory, FILE_NAME)
  const temporary = path.join(directory, `.InterAct.config-${process.pid}.tmp`)
  try {
    const config = normalize(input)
    // One small synchronous write before the renderer reloads. Do not request
    // elevation or silently fall back to another computer's stored settings.
    fs.writeFileSync(temporary, JSON.stringify(config || { ref: '', key: '', appUrl: '' }, null, 2) + '\n', { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(temporary, file)
    return { ok: true }
  } catch (error) {
    return { ok: false, message: `無法儲存隨身設定：${error.message} 請確認隨身碟未防寫，或將程式放到可寫入的資料夾。` }
  } finally {
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) } catch { /* Best effort for interrupted USB writes. */ }
  }
}

module.exports = { configDirectory, normalize, readConfig, writeConfig }
