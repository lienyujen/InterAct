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

export async function runSchema(ref: string, token: string) {
  if (!schemaSql) throw new Error('找不到 schema.sql。')
  const result = await call({
    path: `/v1/projects/${ref}/database/query`,
    method: 'POST',
    token,
    json: { query: schemaSql },
  })
  if (!result.ok) throw new Error(describe(result.body, '建立資料表失敗', result.status))
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
