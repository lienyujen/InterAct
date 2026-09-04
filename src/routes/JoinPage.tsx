import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, UserRound, Waves } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { SetupNotice } from '../components/SetupNotice'
import { StudentSocialLinks } from '../components/StudentSocialLinks'
import { ParticipantLanguageSwitcher } from '../components/ParticipantLanguageSwitcher'
import { getDeviceId } from '../lib/device'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { participantLocaleFromStorage, participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { Participant, Session } from '../types'

export function JoinPage() {
  const { sessionId: sessionReference = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [sessionLookupError, setSessionLookupError] = useState('')
  const [returning, setReturning] = useState(false)
  const [locale, setLocale] = useState<ParticipantLocale>(participantLocaleFromStorage)
  const navigate = useNavigate()
  const location = useLocation()

  function changeLocale(nextLocale: ParticipantLocale) {
    localStorage.setItem('interact_participant_locale', nextLocale)
    setLocale(nextLocale)
  }

  // Students commonly scan, join, wander off, then scan again to come back. The
  // name box was asked a second time but ignored — the server keys a participant
  // to the device, so whatever they typed they returned as their first name.
  // Recognising the device instead skips a step that never did anything.
  useEffect(() => {
    if (!isSupabaseConfigured || !session?.id) return
    const participantId = localStorage.getItem(`interact_participant_${session.id}`)
    const participantToken = localStorage.getItem(`interact_participant_token_${session.id}`)
    if (!participantId || !participantToken) return

    let cancelled = false
    void (async () => {
      try {
        // A stored token can outlive the participant it belonged to, so it is
        // checked before the form is skipped rather than after.
        const { data, error: checkError } = await requireSupabase().functions.invoke('participant-action', {
          body: { action: 'heartbeat', sessionId: session.id, participantId, participantToken, unfocusedMs: 0 },
        })
        if (cancelled) return
        if (checkError || !data?.ok) {
          localStorage.removeItem(`interact_participant_${session.id}`)
          localStorage.removeItem(`interact_participant_token_${session.id}`)
          return
        }
        setReturning(true)
        navigate(`/participant/${session.id}${location.search}`, { replace: true })
      } catch {
        // Offline or the function is missing: fall through to the name form,
        // which still works.
      }
    })()

    return () => {
      cancelled = true
    }
  }, [location.search, navigate, session?.id])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionReference) return

    let cancelled = false
    setSessionChecked(false)
    setSessionLookupError('')
    const isSessionId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionReference)
    requireSupabase()
      .from('sessions')
      .select('*')
      .eq(isSessionId ? 'id' : 'code', sessionReference)
      .maybeSingle()
      .then(({ data, error: lookupError }) => {
        if (cancelled) return
        setSession((data as Session | null) || null)
        setSessionLookupError(lookupError ? (locale === 'en' ? 'Unable to load this session. Please refresh and try again.' : '暫時無法載入場次，請重新整理後再試。') : '')
        setSessionChecked(true)
      })
    return () => {
      cancelled = true
    }
  }, [locale, sessionReference])

  async function joinErrorMessage(joinError: unknown) {
    const response = (joinError as { context?: Response } | null)?.context
    if (response) {
      try {
        const payload = await response.clone().json() as { message?: unknown }
        if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
      } catch {
        // Fall through to the normal error message.
      }
    }
    return joinError instanceof Error ? joinError.message : (locale === 'en' ? 'Unable to join.' : '加入失敗。')
  }

  async function join(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError(locale === 'en' ? 'Name is required.' : '姓名必填。')
      return
    }

    setBusy(true)
    setError('')
    try {
      if (!session) throw new Error(locale === 'en' ? 'Session not found.' : '找不到這個場次。')
      const supabase = requireSupabase()
      const deviceId = getDeviceId()
      const { data, error: joinError } = await supabase.functions.invoke('participant-action', {
        body: { action: 'join_session', sessionReference, name: trimmed, deviceId },
      })
      if (joinError) throw new Error(await joinErrorMessage(joinError))
      if (!data?.participant || !data?.participantToken) throw new Error(data?.message || '加入失敗。')
      const participant = data.participant as Participant
      const sessionId = participant.session_id

      localStorage.setItem(`interact_participant_${sessionId}`, participant.id)
      localStorage.setItem(`interact_participant_token_${sessionId}`, data.participantToken)
      localStorage.setItem(`interact_name_${sessionId}`, participant.name)
      navigate(`/participant/${sessionId}${location.search}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : '加入失敗'
      if (message.includes('找不到這個場次') || message.includes('Session not found')) {
        setSession(null)
        setSessionChecked(true)
      } else {
        setError(message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (sessionChecked && !session && !sessionLookupError) {
    return (
      <main className="participant-page participant-ended-page">
        <ParticipantLanguageSwitcher locale={locale} onChange={changeLocale} />
        <SetupNotice />
        <StudentSocialLinks />
        <section className="participant-ended-hero">
          <span className="participant-ended-icon"><Waves size={34} /></span>
          <h1>{participantText(locale, 'sessionGoneTitle')}</h1>
          <p>{participantText(locale, 'sessionGoneMessage')}</p>
        </section>
      </main>
    )
  }

  // Shown for the moment between recognising the device and the class page
  // appearing, so the name form does not flash up and vanish.
  if (returning) {
    return (
      <main className="center-page">
        <section className="panel form-panel">
          <span className="form-heading-icon"><UserRound size={24} /></span>
          <h1>{locale === 'en' ? 'Welcome back' : '歡迎回到課堂'}</h1>
          <p className="muted">
            {locale === 'en'
              ? `Signing you back in as ${localStorage.getItem(`interact_name_${session?.id}`) || ''}…`
              : `正在以「${localStorage.getItem(`interact_name_${session?.id}`) || ''}」的身分回到課堂…`}
          </p>
        </section>
      </main>
    )
  }

  return (
    <main className="center-page">
      <ParticipantLanguageSwitcher locale={locale} onChange={changeLocale} />
      <SetupNotice />
      <StudentSocialLinks />
      <form autoComplete="off" className="panel form-panel" onSubmit={join}>
        <span className="form-heading-icon"><UserRound size={24} /></span>
        <h1>{locale === 'en' ? `Join ${session?.title || 'session'}` : `加入${session?.title || '場次'}`}</h1>
        <p className="muted">{session?.status === 'ended'
          ? (locale === 'en' ? 'Enter your name to view the class materials' : '輸入姓名即可查看課程內容')
          : (locale === 'en' ? 'Enter your name to join the interactive class' : '輸入姓名後即可進入互動課堂')}</p>
        <label>
          {locale === 'en' ? 'Your name' : '你的姓名'}
          <input
            autoComplete="name"
            autoFocus
            inputMode="text"
            name="participant-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={locale === 'en' ? 'Enter your name' : '請輸入姓名'}
          />
        </label>
        {(error || sessionLookupError) && <p className="error">{error || sessionLookupError}</p>}
        <button disabled={busy || !session || Boolean(sessionLookupError)} type="submit">
          {busy
            ? (locale === 'en' ? 'Joining...' : '加入中...')
            : session?.status === 'ended'
              ? (locale === 'en' ? 'View class' : '查看課程')
              : (locale === 'en' ? 'Join' : '加入')}
          {!busy && <ArrowRight size={18} />}
        </button>
      </form>
    </main>
  )
}
