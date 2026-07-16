import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { SetupNotice } from '../components/SetupNotice'
import { savePresenterToken } from '../lib/presenterAuth'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'

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
      })

      if (createError) throw createError
      if (!data?.sessionId || !data?.presenterToken) throw new Error('建立場次時沒有取得講者權限。')
      savePresenterToken(data.sessionId, data.presenterToken)
      navigate(`/presenter/${data.sessionId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '建立場次失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="center-page">
      <SetupNotice />
      <form className="panel form-panel" onSubmit={createSession}>
        <h1>建立新場次</h1>
        <label>
          場次名稱
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：AI 教學工作坊" />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy} type="submit">
          {busy ? '建立中...' : '建立場次'}
        </button>
      </form>
    </main>
  )
}
