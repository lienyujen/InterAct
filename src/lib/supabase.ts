import { createClient } from '@supabase/supabase-js'

const STORAGE_KEY = 'interact:backend'

export type BackendConfig = {
  ref: string
  url: string
  key: string
  appUrl?: string
}

const refPattern = /^[a-z0-9]{20}$/
const keyPattern = /^sb_publishable_[A-Za-z0-9_-]{8,}$/

function build(ref: string, key: string, appUrl?: string): BackendConfig | null {
  // The project reference is turned into a URL here rather than accepted as one:
  // a join link can therefore only ever point the app at a real Supabase project,
  // never at an arbitrary host dressed up in a trusted domain.
  if (!refPattern.test(ref) || !keyPattern.test(key)) return null
  return { ref, url: `https://${ref}.supabase.co`, key, appUrl: appUrl || undefined }
}

// A student opens the shared page and the link tells it which project hosts the
// session, so the presenter never has to deploy a copy of this page themselves.
function fromJoinLink(): BackendConfig | null {
  if (typeof window === 'undefined') return null
  const query = window.location.hash.split('?')[1]
  if (!query) return null
  const params = new URLSearchParams(query)
  return build(params.get('p') || '', params.get('k') || '')
}

function fromStorage(): BackendConfig | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const saved = JSON.parse(raw) as { ref?: unknown; key?: unknown; appUrl?: unknown }
    return build(String(saved.ref || ''), String(saved.key || ''), String(saved.appUrl || ''))
  } catch {
    return null
  }
}

function fromBuild(): BackendConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!url || !key) return null
  return { ref: new URL(url).hostname.split('.')[0], url: url.replace(/\/$/, ''), key }
}

function remember(config: BackendConfig) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ref: config.ref, key: config.key, appUrl: config.appUrl }))
  } catch {
    // A private window without storage still works for this visit.
  }
}

const linked = fromJoinLink()
if (linked) remember(linked)

// A join link always wins: it is how a student reaches a project this build was
// never configured for. Otherwise fall back to the last one used, then to the
// values baked in at build time.
const config = linked || fromStorage() || fromBuild()

export const backendConfig = config
export const isSupabaseConfigured = Boolean(config)

export const supabase = config
  ? createClient(config.url, config.key, {
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null

export function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase 尚未設定。請建立 .env 並填入 VITE_SUPABASE_URL 與 VITE_SUPABASE_ANON_KEY。')
  }

  return supabase
}

export type SaveResult = { ok: true } | { ok: false; message: string }

// Presenters who downloaded a build rather than packaging one enter their own
// project here. The client is created once at module load, so saving reloads
// the app rather than trying to swap it underneath everything already running.
export function saveBackendConfig(input: { ref: string; key: string; appUrl?: string }): SaveResult {
  const ref = input.ref.trim().replace(/^https:\/\//, '').replace(/\.supabase\.co\/?$/, '')
  const key = input.key.trim()
  const appUrl = (input.appUrl || '').trim().replace(/\/$/, '')

  if (!refPattern.test(ref)) {
    return { ok: false, message: '專案識別碼格式不正確，應為 20 個小寫英數字（可直接貼上 Supabase 專案網址）。' }
  }
  if (!keyPattern.test(key)) {
    return { ok: false, message: '請填入 Supabase 的 publishable key（以 sb_publishable_ 開頭）。' }
  }
  if (appUrl && !/^https:\/\/\S+$/.test(appUrl)) {
    return { ok: false, message: '學員端網址必須以 https:// 開頭。' }
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ref, key, appUrl: appUrl || undefined }))
  } catch {
    return { ok: false, message: '無法寫入本機設定，請確認瀏覽器或系統允許儲存資料。' }
  }
  return { ok: true }
}

export function clearBackendConfig() {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

// Checks the project answers before the presenter commits to it, so a typo is
// caught here instead of halfway through a class.
export async function testBackendConfig(ref: string, key: string) {
  const response = await fetch(`https://${ref}.supabase.co/rest/v1/sessions?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (response.ok) return { ok: true as const }
  if (response.status === 401 || response.status === 403) {
    return { ok: false as const, message: '金鑰無效或權限不足，請確認貼上的是 publishable key。' }
  }
  if (response.status === 404) {
    return { ok: false as const, message: '連得上專案，但找不到 sessions 資料表 —— 請先在 Supabase 執行 schema.sql。' }
  }
  return { ok: false as const, message: `連線失敗（HTTP ${response.status}）。` }
}
