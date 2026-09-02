import { useState } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle2, CircleDashed, ExternalLink, KeyRound, LoaderCircle, Rocket, Save, Server, XCircle } from 'lucide-react'
import { backendConfig, clearBackendConfig, saveBackendConfig, testBackendConfig } from '../lib/supabase'
import { canDeployBackend, checkToken, deployableFunctions, deployFunction, runSchema, setSecrets, verifyBackend } from '../lib/backendDeploy'
import type { DeployStep } from '../lib/backendDeploy'

type Props = {
  onCancel?: () => void
}

const REF_PATTERN = /^[a-z0-9]{20}$/

function normalizeRef(value: string) {
  return value.trim().replace(/^https:\/\//, '').replace(/\.supabase\.co\/?$/, '')
}

export function BackendSetup({ onCancel }: Props) {
  const [ref, setRef] = useState(backendConfig?.ref || '')
  const [key, setKey] = useState(backendConfig?.key || '')
  const [appUrl, setAppUrl] = useState(backendConfig?.appUrl || '')
  const [testing, setTesting] = useState(false)
  const [tested, setTested] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [token, setToken] = useState('')
  const [geminiKey, setGeminiKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [reurlKey, setReurlKey] = useState('')
  const [steps, setSteps] = useState<DeployStep[]>([])
  const [deploying, setDeploying] = useState(false)

  const cleanRef = normalizeRef(ref)

  async function deployBackend() {
    setError('')
    setNotice('')
    if (!REF_PATTERN.test(cleanRef)) {
      setError('請先填入正確的專案識別碼。')
      return
    }
    if (!token.trim()) {
      setError('請填入 Supabase 存取權杖。')
      return
    }

    const plan: DeployStep[] = [
      { slug: '建立資料表與儲存空間', status: 'pending' },
      ...deployableFunctions.map((slug) => ({ slug, status: 'pending' as const })),
      { slug: '設定 API 金鑰', status: 'pending' },
      { slug: '檢查部署結果', status: 'pending' },
    ]
    setSteps(plan)
    setDeploying(true)

    const advance = (index: number, status: DeployStep['status'], message?: string) => {
      setSteps((current) => current.map((step, i) => i === index ? { ...step, status, message } : step))
    }

    try {
      // A network-level failure here would otherwise surface as nothing at all:
      // the button resets, the steps sit unstarted, and no reason is given.
      let tokenCheck: Awaited<ReturnType<typeof checkToken>>
      try {
        tokenCheck = await checkToken(cleanRef, token.trim())
      } catch {
        setError('無法連線到 Supabase 管理 API，請確認網路連線。')
        setSteps([])
        return
      }
      if (!tokenCheck.ok) {
        setError(tokenCheck.message)
        setSteps([])
        return
      }

      const tasks: Array<() => Promise<void>> = [
        () => runSchema(cleanRef, token.trim()),
        ...deployableFunctions.map((slug) => () => deployFunction(cleanRef, token.trim(), slug)),
        () => setSecrets(cleanRef, token.trim(), {
          GEMINI_API_KEY: geminiKey,
          OPENAI_API_KEY: openaiKey,
          REURL_API_KEY: reurlKey,
        }),
        () => verifyBackend(cleanRef, token.trim()),
      ]

      let failed = false
      for (const [index, task] of tasks.entries()) {
        advance(index, 'running')
        try {
          await task()
          advance(index, 'done')
        } catch (caught) {
          advance(index, 'failed', caught instanceof Error ? caught.message : '失敗')
          failed = true
          break
        }
      }
      if (failed) {
        setError('部署中斷。修正上面的問題後可以再按一次，已完成的步驟會直接覆蓋，不會重複。')
      } else {
        setNotice('後端部署完成，測試連線後即可儲存。')
        setToken('')
      }
    } finally {
      setDeploying(false)
    }
  }

  async function runTest() {
    setError('')
    setNotice('')
    setTested(false)
    if (!REF_PATTERN.test(cleanRef)) {
      setError('專案識別碼格式不正確，應為 20 個小寫英數字（可直接貼上 Supabase 專案網址）。')
      return
    }
    setTesting(true)
    try {
      const result = await testBackendConfig(cleanRef, key.trim())
      if (result.ok) {
        setTested(true)
        setNotice('連線成功，可以儲存了。')
      } else {
        setError(result.message)
      }
    } catch {
      setError('連線失敗，請確認網路與專案識別碼。')
    } finally {
      setTesting(false)
    }
  }

  function save() {
    setError('')
    const result = saveBackendConfig({ ref: cleanRef, key, appUrl })
    if (!result.ok) {
      setError(result.message)
      return
    }
    // The Supabase client is built once when the app loads, so restart into it.
    window.location.reload()
  }

  function reset() {
    clearBackendConfig()
    window.location.reload()
  }

  // Shown full-page when nothing is configured yet, and inside a dialog when
  // opened from 系統設定 — the panel itself is the same either way.
  const embedded = Boolean(onCancel)
  const Wrapper = embedded
    ? ({ children }: { children: ReactNode }) => <>{children}</>
    : ({ children }: { children: ReactNode }) => <main className="center-page backend-setup-page">{children}</main>

  return (
    <Wrapper>
      <section className="panel backend-setup">
        <span className="form-heading-icon"><Server size={24} /></span>
        <h1>{embedded ? '系統設定' : '連接你的 Supabase 專案'}</h1>
        <p className="muted">
          InterAct 使用你自己的 Supabase 專案存放課堂資料，資料不會經過其他人。
          填入專案資訊後即可開始使用。
        </p>

        <label>
          專案識別碼或網址
          <input
            autoFocus
            placeholder="abcdefghijklmnopqrst 或 https://abcdefghijklmnopqrst.supabase.co"
            value={ref}
            onChange={(event) => { setRef(event.target.value); setTested(false) }}
          />
        </label>
        <p className="field-hint">Supabase 後台 → Project Settings → General → Project ID</p>

        <label>
          Publishable key
          <input
            placeholder="sb_publishable_..."
            value={key}
            onChange={(event) => { setKey(event.target.value); setTested(false) }}
          />
        </label>
        <p className="field-hint">
          Supabase 後台 → Project Settings → API Keys。這把金鑰設計上就是公開的，由資料庫權限規則保護；
          <strong>請不要填 service_role 或 secret key</strong>。
        </p>

        <label>
          學員端網址（選填）
          <input
            placeholder="不填則使用共用學員端"
            value={appUrl}
            onChange={(event) => setAppUrl(event.target.value)}
          />
        </label>
        <p className="field-hint">
          留空即可 —— QR Code 會指向共用學員端，並自動帶上你的專案，學生資料仍然只進你的 Supabase。
          商業使用者請自行託管並填入自己的網址。
        </p>

        {error && <p className="error">{error}</p>}
        {notice && <p className="success"><CheckCircle2 size={15} /> {notice}</p>}

        <div className="backend-setup-actions">
          <button className="ghost-button" disabled={testing} type="button" onClick={() => void runTest()}>
            {testing ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={17} />}
            {testing ? '測試中...' : '測試連線'}
          </button>
          <button disabled={testing} type="button" onClick={save}>
            <Save size={17} />{tested ? '儲存並開始使用' : '直接儲存'}
          </button>
        </div>

        <details className="backend-setup-help">
          <summary>還沒建立後端？讓 InterAct 幫你部署</summary>
          <p className="muted">
            在 <a href="https://supabase.com/dashboard" rel="noreferrer" target="_blank">
              Supabase 後台 <ExternalLink size={12} />
            </a> 免費建立專案後，到 <a href="https://supabase.com/dashboard/account/tokens" rel="noreferrer" target="_blank">
              Access Tokens <ExternalLink size={12} />
            </a> 產生一組權杖貼在下方，InterAct 會自動建立資料表、部署後端函式並設定金鑰。
          </p>

          <label>
            Supabase 存取權杖
            <input
              placeholder="sbp_..."
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
          </label>
          <p className="field-hint">
            建議建立 fine-grained token 並只勾選這個專案的 <strong>Edge Functions 寫入</strong>與<strong>資料庫查詢</strong>權限。
            權杖只在部署當下使用，不會被儲存。
          </p>

          <label>
            Gemini API key
            <input placeholder="AI 分析用" type="password" value={geminiKey} onChange={(e) => setGeminiKey(e.target.value)} />
          </label>
          <label>
            OpenAI API key（選填）
            <input placeholder="即時字幕與同步口譯，依音訊時長計費" type="password" value={openaiKey} onChange={(e) => setOpenaiKey(e.target.value)} />
          </label>
          <label>
            Reurl API key（選填）
            <input placeholder="QR Code 短網址" type="password" value={reurlKey} onChange={(e) => setReurlKey(e.target.value)} />
          </label>

          <button className="backend-deploy-button" disabled={deploying || !canDeployBackend} type="button" onClick={() => void deployBackend()}>
            {deploying ? <LoaderCircle className="spin" size={17} /> : <Rocket size={17} />}
            {deploying ? '部署中...' : '開始自動部署'}
          </button>

          {!canDeployBackend && <p className="field-hint">自動部署只能在 InterAct 桌面版使用。</p>}

          {steps.length > 0 && (
            <ul className="deploy-steps">
              {steps.map((step) => (
                <li key={step.slug} className={`is-${step.status}`}>
                  {step.status === 'done' && <CheckCircle2 size={14} />}
                  {step.status === 'failed' && <XCircle size={14} />}
                  {step.status === 'running' && <LoaderCircle className="spin" size={14} />}
                  {step.status === 'pending' && <CircleDashed size={14} />}
                  <span>{step.slug}</span>
                  {step.message && <em>{step.message}</em>}
                </li>
              ))}
            </ul>
          )}
        </details>

        <div className="backend-setup-footer">
          {backendConfig && (
            <button className="danger-ghost-button" type="button" onClick={reset}>清除設定</button>
          )}
          {onCancel && (
            <button className="ghost-button" type="button" onClick={onCancel}>取消</button>
          )}
        </div>
      </section>
    </Wrapper>
  )
}
