import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { DanmakuLayer } from '../components/DanmakuLayer'
import { LotteryOverlay } from '../components/LotteryOverlay'
import { finalizeLottery } from '../lib/lottery'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Message, Session, SessionEvent } from '../types'

export function DesktopOverlayPage() {
  const { sessionId = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [lotteryEvent, setLotteryEvent] = useState<SessionEvent | null>(null)

  const loadOverlay = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const [{ data: sessionData }, { data: messageData }, { data: lotteryData }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.from('messages').select('*').eq('session_id', sessionId).order('created_at'),
      supabase
        .from('session_events')
        .select('*')
        .eq('session_id', sessionId)
        .eq('event_type', 'lottery')
        .gte('created_at', new Date(Date.now() - 10_000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])
    setSession(sessionData as Session | null)
    setMessages((messageData || []) as Message[])
    setLotteryEvent((lotteryData as SessionEvent | null) || null)
  }, [sessionId])

  useEffect(() => {
    loadOverlay()
  }, [loadOverlay])

  useEffect(() => window.interactDesktop?.onLottery(setLotteryEvent), [])

  useEffect(() => {
    const pollLatestLottery = async () => {
      const event = await window.interactDesktop?.getLatestLottery()
      if (!event) return
      setLotteryEvent((current) => current?.id === event.id ? current : event)
    }
    void pollLatestLottery()
    const timer = window.setInterval(() => void pollLatestLottery(), 250)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`desktop-overlay:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, loadOverlay)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` }, loadOverlay)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_events', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const event = payload.new as SessionEvent
        if (event.event_type === 'lottery') setLotteryEvent(event)
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadOverlay, sessionId])

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
    </>
  )
}
