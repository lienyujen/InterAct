import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { DanmakuLayer } from '../components/DanmakuLayer'
import { BuzzerOverlay } from '../components/BuzzerOverlay'
import { LotteryOverlay } from '../components/LotteryOverlay'
import { isBuzzerAccepting, isBuzzerPending } from '../lib/buzzer'
import { finalizeLottery } from '../lib/lottery'
import { getPresenterToken } from '../lib/presenterAuth'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { BuzzerSessionEvent, LotterySessionEvent, Message, Session, SessionEvent } from '../types'

export function DesktopOverlayPage() {
  const { sessionId = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [lotteryEvent, setLotteryEvent] = useState<LotterySessionEvent | null>(null)
  const [buzzerEvent, setBuzzerEvent] = useState<BuzzerSessionEvent | null>(null)
  const messageCutoffRef = useRef(new Date().toISOString())

  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]))
      for (const message of incoming) byId.set(message.id, message)
      return [...byId.values()].sort((left, right) => left.created_at.localeCompare(right.created_at))
    })
  }, [])

  const showActivityEvent = useCallback((event: SessionEvent) => {
    if (event.event_type === 'buzzer') {
      setBuzzerEvent((current) => {
        if (
          current?.id === event.id
          && current.payload.accepting === event.payload.accepting
          && current.payload.finalized === event.payload.finalized
          && current.payload.cancelled === event.payload.cancelled
          && current.payload.expires_at === event.payload.expires_at
          && current.payload.winner_id === event.payload.winner_id
        ) return current
        return event
      })
      setLotteryEvent(null)
    } else if (event.event_type === 'lottery' || event.event_type === 'lottery_result') {
      setLotteryEvent((current) => (
        current?.id === event.id
        && current.payload.finalized === event.payload.finalized
        && current.payload.winner_id === event.payload.winner_id
          ? current
          : event
      ))
      setBuzzerEvent(null)
    }
  }, [])

  const loadOverlay = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const [{ data: sessionData }, { data: messageData }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .gte('created_at', messageCutoffRef.current)
        .order('created_at'),
    ])
    setSession(sessionData as Session | null)
    mergeMessages((messageData || []) as Message[])
  }, [mergeMessages, sessionId])

  useEffect(() => {
    loadOverlay()
  }, [loadOverlay])

  useEffect(() => window.interactDesktop?.onLottery(showActivityEvent), [showActivityEvent])

  useEffect(() => {
    const loadLatestActivity = async () => {
      const event = await window.interactDesktop?.getLatestLottery()
      if (!event) return
      showActivityEvent(event)
    }
    void loadLatestActivity()
  }, [showActivityEvent])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`desktop-overlay:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, loadOverlay)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` }, (payload) => {
        mergeMessages([payload.new as Message])
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_events', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const event = payload.new as SessionEvent
        showActivityEvent(event)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadOverlay, mergeMessages, sessionId, showActivityEvent])

  useEffect(() => {
    const interactive = Boolean(
      (lotteryEvent && lotteryEvent.payload.finalized === false)
      || (isBuzzerPending(buzzerEvent) && !isBuzzerAccepting(buzzerEvent)),
    )
    void window.interactDesktop?.setLotteryInteraction(interactive)
    return () => {
      if (interactive) void window.interactDesktop?.setLotteryInteraction(false)
    }
  }, [buzzerEvent, lotteryEvent])

  useEffect(() => {
    if (!buzzerEvent || buzzerEvent.payload.finalized || buzzerEvent.payload.cancelled) return
    const remaining = Date.parse(buzzerEvent.payload.expires_at) - Date.now()
    if (!Number.isFinite(remaining)) return
    const expire = () => setBuzzerEvent((current) => (
      current?.id === buzzerEvent.id
        ? { ...current, payload: { ...current.payload, accepting: false, cancelled: true } }
        : current
    ))
    if (remaining <= 0) {
      expire()
      return
    }
    const timer = window.setTimeout(expire, remaining)
    return () => window.clearTimeout(timer)
  }, [buzzerEvent])

  async function selectLotteryCandidate(winnerId: string) {
    if (!lotteryEvent) return
    setLotteryEvent(await finalizeLottery(sessionId, lotteryEvent.id, winnerId))
  }

  async function activateBuzzer() {
    if (!buzzerEvent || !isBuzzerPending(buzzerEvent) || isBuzzerAccepting(buzzerEvent)) return
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) throw new Error('??????????')
    const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
      body: { action: 'activate_buzzer', sessionId, presenterToken, eventId: buzzerEvent.id },
    })
    if (error) throw error
    if (!data?.event) throw new Error(data?.message || '?????????')
    const nextEvent = data.event as BuzzerSessionEvent
    setBuzzerEvent(nextEvent)
    await window.interactDesktop?.showLottery(nextEvent)
  }

  if (!session) return null
  return (
    <>
      <DanmakuLayer messages={messages} session={session} />
      <LotteryOverlay event={lotteryEvent} onSelect={selectLotteryCandidate} />
      <BuzzerOverlay event={buzzerEvent} onStart={activateBuzzer} />
    </>
  )
}
