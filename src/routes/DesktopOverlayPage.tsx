import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { DanmakuLayer } from '../components/DanmakuLayer'
import { BuzzerOverlay } from '../components/BuzzerOverlay'
import { LotteryOverlay } from '../components/LotteryOverlay'
import { finalizeLottery } from '../lib/lottery'
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
      setBuzzerEvent(event)
      setLotteryEvent(null)
    } else if (event.event_type === 'lottery' || event.event_type === 'lottery_result') {
      setLotteryEvent(event)
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
    const pollLatestLottery = async () => {
      const event = await window.interactDesktop?.getLatestLottery()
      if (!event) return
      showActivityEvent(event)
    }
    void pollLatestLottery()
    const timer = window.setInterval(() => void pollLatestLottery(), 250)
    return () => window.clearInterval(timer)
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
    const interactive = Boolean(lotteryEvent && lotteryEvent.payload.finalized === false)
    void window.interactDesktop?.setLotteryInteraction(interactive)
    return () => {
      if (interactive) void window.interactDesktop?.setLotteryInteraction(false)
    }
  }, [lotteryEvent])

  async function selectLotteryCandidate(winnerId: string) {
    if (!lotteryEvent) return
    setLotteryEvent(await finalizeLottery(sessionId, lotteryEvent.id, winnerId))
  }

  if (!session) return null
  return (
    <>
      <DanmakuLayer messages={messages} session={session} />
      <LotteryOverlay event={lotteryEvent} onSelect={selectLotteryCandidate} />
      <BuzzerOverlay event={buzzerEvent} />
    </>
  )
}
