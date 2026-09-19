import { Cloud, MessageSquareText } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BUILT_IN_TERMS, parseTermInput, readCustomTerms, writeCustomTerms } from '../lib/wordCloudTerms'
import { useParams } from 'react-router-dom'
import { WordCloudCanvas } from '../components/WordCloudCanvas'
import { DanmakuTimeline } from '../components/DanmakuTimeline'
import { currentBurst } from '../lib/danmakuBursts'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Message, Session } from '../types'


export function WordCloudPage() {
  const { sessionId = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [termsOpen, setTermsOpen] = useState(false)
  const [termText, setTermText] = useState('')
  const [customTerms, setCustomTerms] = useState<string[]>(readCustomTerms)
  // Null means the presenter has not touched the timeline, so the cloud keeps
  // following the newest wave. The moment they drag it, it is theirs and stops
  // jumping away while they are reading it.
  const [pinned, setPinned] = useState<{ from: number; to: number } | null>(null)
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

      // The whole session, always. The timeline draws the shape of the entire
      // class so the presenter can reach back to an earlier wave, which it
      // cannot do from a window that was trimmed away at load time.
      const loaded: Message[] = []
      for (let from = 0; ; from += 1000) {
        const query = supabase.from('messages').select('*').eq('session_id', sessionId)
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
  }, [sessionId])

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

  const times = useMemo(
    () => messages.map((message) => new Date(message.created_at).getTime()).sort((a, b) => a - b),
    [messages],
  )

  // The session runs from its first message to now, so the track keeps growing
  // while the class does. A minute of padding stops the newest bar sitting
  // exactly on the right edge where the handle is.
  const bounds = useMemo(() => {
    const first = times[0] ?? now - 60_000
    return { start: first, end: Math.max(now, (times.at(-1) ?? now)) + 30_000 }
  }, [times, now])

  const selection = useMemo(() => {
    if (pinned) return pinned
    const burst = currentBurst(times)
    if (!burst) return { from: bounds.start, to: bounds.end }
    return { from: burst.start - 1000, to: bounds.end }
  }, [pinned, times, bounds])

  const visibleMessages = useMemo(
    () => messages.filter((message) => {
      const at = new Date(message.created_at).getTime()
      return at >= selection.from && at <= selection.to
    }),
    [messages, selection],
  )

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
            <button
              aria-pressed={!pinned}
              className={!pinned ? 'selected' : ''}
              type="button"
              onClick={() => setPinned(null)}
            >
              這一波
            </button>
            <button
              aria-pressed={Boolean(pinned) && selection.from <= bounds.start}
              className={pinned && selection.from <= bounds.start ? 'selected' : ''}
              type="button"
              onClick={() => setPinned({ from: bounds.start, to: bounds.end })}
            >
              整個場次
            </button>
          </div>
          <button
            className="ghost-button word-cloud-terms-toggle"
            type="button"
            onClick={() => { setTermText(customTerms.join('\n')); setTermsOpen((open) => !open) }}
          >
            自訂詞彙
          </button>
        </div>
      </header>
      {times.length > 0 && (
        <DanmakuTimeline
          selection={selection}
          sessionEnd={bounds.end}
          sessionStart={bounds.start}
          times={times}
          onChange={setPinned}
        />
      )}
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
