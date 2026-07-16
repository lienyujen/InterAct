import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { DanmakuLayer } from '../components/DanmakuLayer'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Message, Session } from '../types'

export function DesktopOverlayPage() {
  const { sessionId = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])

  const loadOverlay = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const [{ data: sessionData }, { data: messageData }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.from('messages').select('*').eq('session_id', sessionId).order('created_at'),
    ])
    setSession(sessionData as Session | null)
    setMessages((messageData || []) as Message[])
  }, [sessionId])

  useEffect(() => {
    loadOverlay()
  }, [loadOverlay])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`desktop-overlay:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, loadOverlay)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` }, loadOverlay)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadOverlay, sessionId])

  if (!session) return null
  return <DanmakuLayer messages={messages} session={session} />
}
