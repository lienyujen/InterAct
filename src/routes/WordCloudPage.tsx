import { Cloud, MessageSquareText } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BUILT_IN_TERMS, parseTermInput, readCustomTerms, writeCustomTerms } from '../lib/wordCloudTerms'
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
  const [termsOpen, setTermsOpen] = useState(false)
  const [termText, setTermText] = useState('')
  const [customTerms, setCustomTerms] = useState<string[]>(readCustomTerms)
  const [range, setRange] = useState<CloudRange>('all')
  const [now, setNow] = useState(Date.now())
  const [loadError, setLoadError] = useState('')
  const loadingRef = useRef(false)
  const loadSequenceRef = useRef(0)
  const latestMessageAtRef = useRef('')

  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]))
      for (const message of incoming) byId.set(message.id, message)
      const merged = [...byId.values()].sort((left, right) => left.created_at.localeCompare(right.created_at))
      latestMessageAtRef.current = merged.at(-1)?.created_at || ''
      return merged
    })
  }, [])

  const loadCloud = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId) return
    const sequence = ++loadSequenceRef.current
    loadingRef.current = true
    const supabase = requireSupabase()
    try {
      const { data: sessionData, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', sessionId)
        .single()
      if (sessionError) throw sessionError
      setSession(sessionData as Session)

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
      if (sequence === loadSequenceRef.current) {
        setMessages(loaded)
        latestMessageAtRef.current = loaded.at(-1)?.created_at || ''
        setLoadError('')
      }
    } catch (error) {
      if (sequence === loadSequenceRef.current) {
        setLoadError(error instanceof Error ? error.message : '無法讀取彈幕資料。')
      }
    } finally {
      if (sequence === loadSequenceRef.current) loadingRef.current = false
    }
  }, [range, sessionId])

  const refreshCloud = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId || loadingRef.current) return
    if (!latestMessageAtRef.current) {
      await loadCloud()
      return
    }

    loadingRef.current = true
    const supabase = requireSupabase()
    try {
      const incoming: Message[] = []
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('session_id', sessionId)
          .gte('created_at', latestMessageAtRef.current)
          .order('created_at')
          .range(from, from + 999)
        if (error) throw error
        const page = (data || []) as Message[]
        incoming.push(...page)
        if (page.length < 1000) break
      }
      mergeMessages(incoming)
      setLoadError('')
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : '無法更新彈幕資料。')
    } finally {
      loadingRef.current = false
    }
  }, [loadCloud, mergeMessages, sessionId])

  useEffect(() => {
    void loadCloud()
  }, [loadCloud])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`word-cloud:${sessionId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` }, (payload) => {
        mergeMessages([payload.new as Message])
      })
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [mergeMessages, sessionId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNow(Date.now())
      void refreshCloud()
    }, 5000)
    return () => window.clearInterval(timer)
  }, [refreshCloud])

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
          <button
            className="ghost-button word-cloud-terms-toggle"
            type="button"
            onClick={() => { setTermText(customTerms.join('\n')); setTermsOpen((open) => !open) }}
          >
            自訂詞彙
          </button>
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
      {loadError && <p className="word-cloud-error" role="alert">文字雲更新失敗：{loadError}</p>}
      {termsOpen && (
        <section className="word-cloud-terms" aria-label="自訂詞彙">
          <p className="muted">
            一行一個詞，用逗號或頓號分隔也可以。內建 {BUILT_IN_TERMS.length} 個領域詞
            （人工智慧、華語教學、語言學、教學設計、企業管理等），這裡加的是你自己課上的說法。
          </p>
          <textarea
            aria-label="自訂詞彙"
            placeholder={'例如：\n教學實踐研究\n數位人文'}
            rows={5}
            value={termText}
            onChange={(event) => setTermText(event.target.value)}
          />
          <div className="word-cloud-terms-actions">
            <button
              type="button"
              onClick={() => {
                const saved = writeCustomTerms(parseTermInput(termText))
                setTermText(saved.join('\n'))
                setCustomTerms(saved)
                setTermsOpen(false)
              }}
            >
              儲存並套用
            </button>
            <button className="ghost-button" type="button" onClick={() => setTermsOpen(false)}>取消</button>
          </div>
        </section>
      )}
      <WordCloudCanvas customTerms={customTerms} messages={visibleMessages} />
    </main>
  )
}
