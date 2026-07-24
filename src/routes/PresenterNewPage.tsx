import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Sparkles } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { SetupNotice } from '../components/SetupNotice'
import { savePresenterToken } from '../lib/presenterAuth'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'

async function getFunctionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return '建立場次失敗'

  const response = (error as Error & { context?: Response }).context
  if (!response) return error.message

  try {
    const body = await response.clone().json()
    if (typeof body?.message === 'string') return body.message
  } catch {
    // Fall back to the SDK message when the response is not JSON.
  }

  return error.message
}

export function PresenterNewPage() {
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  async function createSession(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!isSupabaseConfigured) {
      setError('請先設定 Supabase。')
      return
    }

    setBusy(true)
    try {
      const { data, error: createError } = await requireSupabase().functions.invoke('create-session', {
        body: { title: title.trim() || '未命名場次' },
        headers: { 'x-interact-client': 'windows-app' },
      })

      if (createError) throw createError
      if (!data?.sessionId || !data?.presenterToken) throw new Error('建立場次時沒有取得講者權限。')
      savePresenterToken(data.sessionId, data.presenterToken)
      navigate(`/presenter/${data.sessionId}`)
    } catch (err) {
      setError(await getFunctionErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="center-page">
      <SetupNotice />
      <form className="panel form-panel" onSubmit={createSession}>
        <span className="form-heading-icon"><Sparkles size={24} /></span>
        <h1>建立新場次</h1>
        <p className="muted">建立場次，讓學生掃碼即可加入</p>
        <label>
          場次名稱
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：AI 教學工作坊" />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy} type="submit">
          {busy ? '建立中...' : '建立場次'}
          {!busy && <ArrowRight size={18} />}
        </button>
      </form>
    </main>
  )
}
