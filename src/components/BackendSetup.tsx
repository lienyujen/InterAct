import { useState } from 'react'
import { CheckCircle2, ExternalLink, KeyRound, LoaderCircle, Save, Server } from 'lucide-react'
import { backendConfig, clearBackendConfig, saveBackendConfig, testBackendConfig } from '../lib/supabase'

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

  const cleanRef = normalizeRef(ref)

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

  return (
    <main className="center-page backend-setup-page">
      <section className="panel backend-setup">
        <span className="form-heading-icon"><Server size={24} /></span>
        <h1>連接你的 Supabase 專案</h1>
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
        <p className="field-hint">Supabase 後台 → Project Settings → General → Reference ID</p>

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
          <summary>還沒有 Supabase 專案？</summary>
          <ol>
            <li>
              到 <a href="https://supabase.com/dashboard" rel="noreferrer" target="_blank">
                Supabase 後台 <ExternalLink size={12} />
              </a> 免費建立一個專案。
            </li>
            <li>開啟 SQL Editor，貼上並執行專案裡的 <code>supabase/schema.sql</code>，建立資料表與儲存空間。</li>
            <li>部署 <code>supabase/functions</code> 底下的 Edge Functions。</li>
            <li>在 Edge Functions 的 Secrets 設定 <code>GEMINI_API_KEY</code>（AI 分析用）。<code>OPENAI_API_KEY</code>（即時字幕與口譯）與 <code>REURL_API_KEY</code>（短網址）為選填。</li>
          </ol>
          <p className="muted">完整步驟請見專案的部署教學文件。</p>
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
    </main>
  )
}
