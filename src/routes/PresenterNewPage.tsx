import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { SetupNotice } from '../components/SetupNotice'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'

function makeCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase()
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
      const supabase = requireSupabase()
      const { data, error: insertError } = await supabase
        .from('sessions')
        .insert({ title: title.trim() || '未命名場次', code: makeCode() })
        .select('id')
        .single()

      if (insertError) throw insertError
      navigate(`/presenter/${data.id}`)
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
