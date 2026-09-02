// Deploys the backend straight from the app, so nobody has to install the
// Supabase CLI to get started. The request shape mirrors what the CLI sends:
// multipart/form-data with one JSON `metadata` part and a `file` part per
// source file, named by its path relative to the project root.
//
// The Management API sends no CORS headers, so every call goes through the
// Electron main process. That also means this only works in the desktop app.

// Vite inlines these at build time, so the sources travel inside the app.
const functionSources = import.meta.glob('/supabase/functions/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const schemaSql = Object.values(
  import.meta.glob('/supabase/schema.sql', { query: '?raw', import: 'default', eager: true }),
)[0] as string | undefined

export const deployableFunctions = [
  'create-session',
  'participant-action',
  'presenter-action',
  'analyze-question',
  'analyze-session',
  'generate-exit-ticket',
  'shorten-url',
  'openai-realtime-session',
] as const

export type DeployStep = {
  slug: string
  status: 'pending' | 'running' | 'done' | 'failed'
  message?: string
}

export const canDeployBackend = typeof window !== 'undefined' && Boolean(window.interactDesktop?.supabaseManagement)

type ManagementRequest = {
  path: string
  method?: string
  token: string
  json?: unknown
  files?: Array<{ name: string; contents: string }>
  metadata?: unknown
}

async function call(request: ManagementRequest) {
  const bridge = window.interactDesktop?.supabaseManagement
  if (!bridge) throw new Error('自動部署只能在 InterAct 桌面版使用。')
  return bridge(request)
}

function describe(body: string, fallback: string, status: number) {
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: unknown }
    const detail = typeof parsed.message === 'string' ? parsed.message
      : typeof parsed.error === 'string' ? parsed.error
        : ''
    if (detail) return detail
  } catch {
    // Not JSON — fall through to the generic message.
  }
  return status ? `${fallback}（HTTP ${status}）` : `${fallback}：${body.slice(0, 120)}`
}

function sourcesFor(slug: string) {
  const prefix = `/supabase/functions/${slug}/`
  const own = Object.entries(functionSources).filter(([path]) => path.startsWith(prefix))
  const shared = Object.entries(functionSources).filter(([path]) => path.startsWith('/supabase/functions/_shared/'))
  return [...own, ...shared]
}

export async function deployFunction(ref: string, token: string, slug: string) {
  const files = sourcesFor(slug)
  if (!files.length) throw new Error(`找不到 ${slug} 的原始碼。`)

  const result = await call({
    path: `/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`,
    method: 'POST',
    token,
    metadata: {
      name: slug,
      verify_jwt: false,
      entrypoint_path: `supabase/functions/${slug}/index.ts`,
      import_map_path: '',
      static_patterns: [],
    },
    // Names are anchored at the project root, matching the CLI's own uploads.
    files: files.map(([path, contents]) => ({ name: path.replace(/^\//, ''), contents })),
  })
  if (!result.ok) throw new Error(describe(result.body, `${slug} 部署失敗`, result.status))
}

// The CLI asks for this before every query it runs. Without it the query role
// lacks the rights to write outside `public`, which is where the storage buckets
// live — the schema then appears to apply while creating no buckets at all.
async function elevate(ref: string, token: string) {
  try {
    await call({ path: `/v1/projects/${ref}/cli/login-role`, method: 'POST', token, json: {} })
  } catch {
    // Older projects may not offer it; the query below still reports any failure.
  }
}

async function query(ref: string, token: string, sql: string, whatFailed: string) {
  await elevate(ref, token)
  const result = await call({
    path: `/v1/projects/${ref}/database/query`,
    method: 'POST',
    token,
    json: { query: sql },
  })
  if (!result.ok) throw new Error(describe(result.body, whatFailed, result.status))
  // A SQL error can come back with a 200, which would otherwise look like success
  // and leave the project half-built with nothing to show for it.
  try {
    const parsed = JSON.parse(result.body) as unknown
    const payload = Array.isArray(parsed) ? parsed[0] : parsed
    const detail = (payload as { error?: unknown; message?: unknown })?.error
      ?? (payload as { message?: unknown })?.message
    if (typeof detail === 'string' && detail.trim()) throw new Error(`${whatFailed}：${detail}`)
  } catch (caught) {
    if (caught instanceof Error && caught.message.startsWith(whatFailed)) throw caught
    // A non-JSON body is what a plain successful statement returns.
  }
  return result.body
}

export async function runSchema(ref: string, token: string) {
  if (!schemaSql) throw new Error('找不到 schema.sql。')
  await query(ref, token, schemaSql, '建立資料表失敗')
}

// Confirms the project really has what the app needs. Without this a schema that
// silently did nothing would only surface later as an unexplained failure the
// first time someone tries to dispatch a screenshot.
export async function verifyBackend(ref: string, token: string) {
  const body = await query(
    ref,
    token,
    `select
       (select count(*) from information_schema.tables
          where table_schema = 'public' and table_name in ('sessions','questions','participants','shared_files')) as tables,
       (select count(*) from storage.buckets
          where id in ('interact-screenshots','interact-recordings','interact-files')) as buckets,
       (select count(*) from information_schema.columns
          where table_schema = 'public'
            and (table_name, column_name) in (
              ('questions','translations'),
              ('questions','allow_multiple'),
              ('sessions','exit_ticket_prompt_en'),
              ('sessions','interpretation_languages'),
              ('sessions','caption_position')
            )) as columns`,
    '檢查部署結果失敗',
  )

  const first = (() => {
    try {
      const parsed = JSON.parse(body) as unknown
      if (Array.isArray(parsed)) return parsed[0] as { tables?: number; buckets?: number; columns?: number }
      const wrapped = parsed as { rows?: unknown[]; result?: unknown[]; data?: unknown[] }
      const rows = wrapped.rows || wrapped.result || wrapped.data
      return rows?.[0] as { tables?: number; buckets?: number; columns?: number } | undefined
    } catch {
      return undefined
    }
  })()

  if (!first) throw new Error('無法讀取部署結果，請到 Supabase 後台確認資料表與 Storage 是否建立。')
  if (Number(first.tables) < 4) throw new Error(`資料表未建立完整（找到 ${first.tables ?? 0}/4），請重新執行部署。`)
  if (Number(first.columns) < 5) {
    throw new Error(`資料表缺少必要欄位（找到 ${first.columns ?? 0}/5）。這通常表示專案是用舊版建立的 —— 再按一次自動部署即可補齊。`)
  }
  if (Number(first.buckets) < 3) {
    throw new Error(`Storage bucket 未建立完整（找到 ${first.buckets ?? 0}/3）。請到 Supabase 後台 → Storage 手動建立 interact-screenshots（公開）、interact-files（公開）與 interact-recordings（非公開）。`)
  }
}

export async function setSecrets(ref: string, token: string, secrets: Record<string, string>) {
  const entries = Object.entries(secrets)
    .map(([name, value]) => ({ name, value: value.trim() }))
    .filter((entry) => entry.value)
  if (!entries.length) return

  const result = await call({
    path: `/v1/projects/${ref}/secrets`,
    method: 'POST',
    token,
    json: entries,
  })
  if (!result.ok) throw new Error(describe(result.body, '設定金鑰失敗', result.status))
}

// Fails fast on a token that cannot do the job, rather than part way through.
export async function checkToken(ref: string, token: string) {
  const result = await call({ path: `/v1/projects/${ref}/functions`, token })
  if (result.ok) return { ok: true as const }
  if (result.status === 401) return { ok: false as const, message: '權杖無效或已過期。' }
  if (result.status === 403) {
    return { ok: false as const, message: '權杖權限不足，請確認已勾選 Edge Functions 的寫入權限。' }
  }
  if (result.status === 404) return { ok: false as const, message: '找不到這個專案，請確認專案識別碼。' }
  if (result.status === 0) return { ok: false as const, message: `無法連線到 Supabase：${result.body.slice(0, 100)}` }
  return { ok: false as const, message: describe(result.body, '權杖檢查失敗', result.status) }
}
