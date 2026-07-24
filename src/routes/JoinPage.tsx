import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, UserRound } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { SetupNotice } from '../components/SetupNotice'
import { StudentSocialLinks } from '../components/StudentSocialLinks'
import { getDeviceId } from '../lib/device'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Participant, Session } from '../types'

export function JoinPage() {
  const { sessionId: sessionReference = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionReference) return

    const isSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionReference)
    requireSupabase()
      .from('sessions')
      .select('*')
      .eq(isSessionId ? 'id' : 'code', sessionReference)
      .single()
      .then(({ data }) => setSession(data as Session | null))
  }, [sessionReference])

  async function join(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('姓名必填。')
      return
    }

    setBusy(true)
    setError('')
    try {
      if (!session) throw new Error('找不到這個場次。')
      const sessionId = session.id
      const supabase = requireSupabase()
      const deviceId = getDeviceId()
      const { data: existing } = await supabase
        .from('participants')
        .select('*')
        .eq('session_id', sessionId)
        .eq('device_id', deviceId)
        .maybeSingle()

      let participant = existing as Participant | null
      if (!participant) {
        const { data, error: insertError } = await supabase
          .from('participants')
          .insert({ session_id: sessionId, name: trimmed, device_id: deviceId })
          .select('*')
          .single()

        if (insertError) throw insertError
        participant = data as Participant
      }

      localStorage.setItem(`interact_participant_${sessionId}`, participant.id)
      localStorage.setItem(`interact_name_${sessionId}`, participant.name)
      navigate(`/participant/${sessionId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加入失敗')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="center-page">
      <SetupNotice />
      <StudentSocialLinks />
      <form autoComplete="off" className="panel form-panel" onSubmit={join}>
        <span className="form-heading-icon"><UserRound size={24} /></span>
        <h1>加入{session?.title || '場次'}</h1>
        <p className="muted">輸入姓名後即可進入互動課堂</p>
        <label>
          你的姓名
          <input
            autoComplete="name"
            autoFocus
            inputMode="text"
            name="participant-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="請輸入姓名"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy} type="submit">
          {busy ? '加入中...' : '加入'}
          {!busy && <ArrowRight size={18} />}
        </button>
      </form>
    </main>
  )
}
