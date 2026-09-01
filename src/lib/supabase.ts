import { createClient } from '@supabase/supabase-js'

const STORAGE_KEY = 'interact:backend'

export type BackendConfig = {
  ref: string
  url: string
  key: string
}

const refPattern = /^[a-z0-9]{20}$/
const keyPattern = /^sb_publishable_[A-Za-z0-9_-]{8,}$/

function build(ref: string, key: string): BackendConfig | null {
  // The project reference is turned into a URL here rather than accepted as one:
  // a join link can therefore only ever point the app at a real Supabase project,
  // never at an arbitrary host dressed up in a trusted domain.
  if (!refPattern.test(ref) || !keyPattern.test(key)) return null
  return { ref, url: `https://${ref}.supabase.co`, key }
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
    const saved = JSON.parse(raw) as { ref?: unknown; key?: unknown }
    return build(String(saved.ref || ''), String(saved.key || ''))
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
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ref: config.ref, key: config.key }))
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
