import { Cloud, MessageSquareText } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { WordCloudCanvas } from '../components/WordCloudCanvas'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Message, Session } from '../types'

type CloudRange = 'all' | '3m' | '10m' | '1h'

const rangeOptions: Array<{ value: CloudRange; label: string; milliseconds: number | null }> = [
  { value: 'all', label: '整個場次', milliseconds: null },
  { value: '3m', label: '3 分鐘', milliseconds: 3 * 60 * 1000 },
  { value: '10m', label: '10 分鐘', milliseconds: 10 * 60 * 1000 },
  { value: '1h', label: '1 小時', milliseconds: 60 * 60 * 1000 },
]

function cutoffFor(range: CloudRange) {
  const milliseconds = rangeOptions.find((option) => option.value === range)?.milliseconds
  return milliseconds ? new Date(Date.now() - milliseconds).toISOString() : null
}

export function WordCloudPage() {
  const { sessionId = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [range, setRange] = useState<CloudRange>('all')
  const [now, setNow] = useState(Date.now())

  const loadCloud = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const { data: sessionData } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
    setSession(sessionData as Session | null)

    const loaded: Message[] = []
    const cutoff = cutoffFor(range)
    for (let from = 0; ; from += 1000) {
      let query = supabase.from('messages').select('*').eq('session_id', sessionId)
      if (cutoff) query = query.gte('created_at', cutoff)
      const { data, error } = await query.order('created_at').range(from, from + 999)
      if (error) throw error
      const page = (data || []) as Message[]
      loaded.push(...page)
      if (page.length < 1000) break
    }
    setMessages(loaded)
  }, [range, sessionId])

  useEffect(() => {
    void loadCloud()
  }, [loadCloud])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`word-cloud:${sessionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` }, (payload) => {
        setMessages((current) => [...current, payload.new as Message])
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [sessionId])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])

  const visibleMessages = useMemo(() => {
    const milliseconds = rangeOptions.find((option) => option.value === range)?.milliseconds
    if (!milliseconds) return messages
    const cutoff = now - milliseconds
    return messages.filter((message) => new Date(message.created_at).getTime() >= cutoff)
  }, [messages, now, range])

  return (
    <main className="word-cloud-page">
      <header className="word-cloud-header">
        <div>
          <p><Cloud size={20} />InterAct 彈幕文字雲</p>
          <h1>{session?.title || '載入場次...'}</h1>
        </div>
        <div className="word-cloud-tools">
          <span><MessageSquareText size={16} />{visibleMessages.length} 則彈幕</span>
          <div className="segmented-control" aria-label="文字雲統計範圍">
            {rangeOptions.map((option) => (
              <button
                aria-pressed={range === option.value}
                className={range === option.value ? 'selected' : ''}
                key={option.value}
                type="button"
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>
      <WordCloudCanvas messages={visibleMessages} />
    </main>
  )
}
