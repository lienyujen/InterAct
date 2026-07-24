import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { BookOpen, PartyPopper, Send, Sparkles } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { ParticipantQuestionView } from '../components/ParticipantQuestionView'
import { BuzzerOverlay } from '../components/BuzzerOverlay'
import { ExitTicketForm } from '../components/ExitTicketForm'
import { LotteryOverlay } from '../components/LotteryOverlay'
import { SharedContentPanel } from '../components/SharedContentPanel'
import { SetupNotice } from '../components/SetupNotice'
import { StudentSocialLinks } from '../components/StudentSocialLinks'
import { isBuzzerAccepting } from '../lib/buzzer'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { useSessionPresence } from '../lib/useSessionPresence'
import type { AiSummary, Answer, BuzzerSessionEvent, ExitTicket, LotterySessionEvent, Participant, Question, Screenshot, Session, SessionAnalysis, SessionEvent, SharedContent } from '../types'

export function ParticipantPage() {
  const { sessionId = '' } = useParams()
  const participantId = localStorage.getItem(`interact_participant_${sessionId}`)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)
  const [exitTicket, setExitTicket] = useState<ExitTicket | null>(null)
  const [sessionSummary, setSessionSummary] = useState<SessionAnalysis | null>(null)
  const [sharedContents, setSharedContents] = useState<SharedContent[]>([])
  const [lotteryEvent, setLotteryEvent] = useState<LotterySessionEvent | null>(null)
  const [buzzerEvent, setBuzzerEvent] = useState<BuzzerSessionEvent | null>(null)
  const [buzzerBusy, setBuzzerBusy] = useState(false)
  const [exitTicketBusy, setExitTicketBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  useSessionPresence(sessionId, session?.status === 'active' ? participant : null)

  const loadAll = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId || !participantId) return
    const supabase = requireSupabase()
    const [{ data: sessionData }, { data: participantData }, { data: exitTicketData }, { data: sharedContentData }, { data: buzzerData }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.from('participants').select('*').eq('id', participantId).single(),
      supabase.from('exit_tickets').select('*').eq('session_id', sessionId).eq('participant_id', participantId).maybeSingle(),
      supabase.from('shared_contents').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }),
      supabase.from('session_events').select('*').eq('session_id', sessionId).eq('event_type', 'buzzer').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    const nextSession = sessionData as Session | null
    setSession(nextSession)
    setParticipant(participantData as Participant | null)
    setExitTicket((exitTicketData as ExitTicket | null) || null)
    setSharedContents((sharedContentData || []) as SharedContent[])
    setBuzzerEvent((buzzerData as BuzzerSessionEvent | null) || null)

    if (nextSession?.status === 'ended') {
      const { data: summaryData } = await supabase
        .from('ai_summaries')
        .select('*')
        .eq('session_id', sessionId)
        .eq('type', 'exit_ticket_summary')
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      setSessionSummary(((summaryData as AiSummary | null)?.output_json as SessionAnalysis | undefined) || null)
    } else {
      setSessionSummary(null)
    }

    if (nextSession?.current_question_id) {
      const [{ data: questionData }, { data: answerData }] = await Promise.all([
        supabase.from('questions').select('*').eq('id', nextSession.current_question_id).single(),
        supabase.from('answers').select('*').eq('question_id', nextSession.current_question_id).eq('participant_id', participantId).maybeSingle(),
      ])
      const nextQuestion = questionData as Question | null
      setQuestion(nextQuestion)
      setAnswer((answerData as Answer | null) || null)

      if (nextQuestion?.screenshot_id) {
        const { data } = await supabase.from('screenshots').select('*').eq('id', nextQuestion.screenshot_id).single()
        setScreenshot(data as Screenshot | null)
      }
    } else {
      setQuestion(null)
      setAnswer(null)
      setScreenshot(null)
    }
  }, [participantId, sessionId])

  useEffect(() => {
    if (!participantId) navigate(`/join/${sessionId}`)
  }, [navigate, participantId, sessionId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId || !participantId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`participant:${sessionId}:${participantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: `participant_id=eq.${participantId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screenshots', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exit_tickets', filter: `participant_id=eq.${participantId}` }, loadAll)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ai_summaries', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shared_contents', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_events', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const event = payload.new as SessionEvent
        if (event.event_type === 'buzzer') {
          setBuzzerEvent(event)
          setLotteryEvent(null)
          return
        }
        if (event.event_type === 'lottery' || event.event_type === 'lottery_result') {
          setBuzzerEvent(null)
          if (event.payload.finalized !== false && event.payload.winner_id === participantId) {
            setLotteryEvent(event)
          } else {
            setLotteryEvent((current) => current?.id === event.id ? null : current)
          }
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadAll, participantId, sessionId])

  useEffect(() => {
    if (session?.status !== 'ended') return
    setMessage('')
    setError('')
    setLotteryEvent(null)
    setBuzzerEvent(null)
  }, [session?.status])

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const content = Array.from(message.trim()).slice(0, 36).join('')
    if (!participant || session?.status !== 'active' || !content) return
    setError('')
    try {
      await requireSupabase().from('messages').insert({
        session_id: sessionId,
        participant_id: participant.id,
        participant_name: participant.name,
        content,
        anonymous_at_display: session?.anonymous_enabled ?? true,
      })
      setMessage('')
    } catch (err) {
      setError(err instanceof Error ? err.message : '送出失敗')
    }
  }

  async function submitAnswer(value: string | string[]) {
    if (!participant || session?.status !== 'active' || !question || question.status !== 'active') return
    const isShortAnswer = question.type === 'short_answer'
    const answerValues = Array.isArray(value) ? value : null
    const singleValue = Array.isArray(value) ? null : value
    try {
      const { data, error: insertError } = await requireSupabase()
        .from('answers')
        .insert({
          session_id: sessionId,
          question_id: question.id,
          participant_id: participant.id,
          participant_name: participant.name,
          answer_value: isShortAnswer ? null : singleValue,
          answer_values: isShortAnswer ? null : answerValues,
          answer_text: isShortAnswer ? singleValue : null,
        })
        .select('*')
        .single()
      if (insertError) throw insertError
      setAnswer(data as Answer)
    } catch (err) {
      setError(err instanceof Error ? err.message : '作答失敗，可能已經提交過。')
    }
  }

  async function submitExitTicket(value: { responseText: string; rating: number }) {
    if (!participant || session?.status !== 'active' || !session.exit_ticket_prompt) return
    setExitTicketBusy(true)
    setError('')
    try {
      const { data, error: insertError } = await requireSupabase()
        .from('exit_tickets')
        .insert({
          session_id: sessionId,
          participant_id: participant.id,
          participant_name: participant.name,
          response_text: value.responseText,
          rating: value.rating,
          understanding_score: value.rating,
          engagement_score: null,
        })
        .select('*')
        .single()
      if (insertError) throw insertError
      setExitTicket(data as ExitTicket)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Exit Ticket 送出失敗，可能已經提交過。')
    } finally {
      setExitTicketBusy(false)
    }
  }

  async function claimBuzzer() {
    const currentBuzzerEvent = buzzerEvent
    if (session?.status !== 'active' || !participant || !currentBuzzerEvent || !isBuzzerAccepting(currentBuzzerEvent)) return
    setBuzzerBusy(true)
    setError('')
    try {
      const { data, error: claimError } = await requireSupabase().functions.invoke('participant-action', {
        body: {
          action: 'claim_buzzer',
          sessionId,
          participantId: participant.id,
          eventId: currentBuzzerEvent.id,
        },
      })
      if (claimError) throw claimError
      if (!data?.event) throw new Error(data?.message || '搶答失敗。')
      setBuzzerEvent(data.event as BuzzerSessionEvent)
    } catch (err) {
      setError(err instanceof Error ? err.message : '搶答失敗，請稍後再試。')
      throw err
    } finally {
      setBuzzerBusy(false)
    }
  }

  if (session?.status === 'ended') {
    return (
      <main className="participant-page participant-ended-page">
        <SetupNotice />
        <StudentSocialLinks />
        <section className="participant-ended-hero">
          <span className="participant-ended-icon"><PartyPopper size={34} /></span>
          <p className="eyebrow">課程已結束</p>
          <h1>下課啦！</h1>
          <p>{participant?.name ? `${participant.name}，謝謝你的參與。` : '謝謝你的參與。'}</p>
        </section>
        <section className="panel participant-summary-panel" aria-live="polite">
          <div className="participant-summary-heading">
            <span className="heading-icon"><Sparkles size={18} /></span>
            <div>
              <p className="eyebrow">AI 課程總結</p>
              <h2>今天的課程重點</h2>
            </div>
          </div>
          {sessionSummary ? (
            <div className="participant-summary-content">
              <p className="participant-summary-lead">{sessionSummary.executive_summary}</p>
              <div className="participant-summary-section">
                <h3><BookOpen size={18} />學習整理</h3>
                <p>{sessionSummary.learning_analysis.overall_understanding}</p>
              </div>
              {sessionSummary.learning_analysis.strengths.length > 0 && (
                <div className="participant-summary-section">
                  <h3>本次掌握的重點</h3>
                  <ul>
                    {sessionSummary.learning_analysis.strengths.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}
              {sessionSummary.learning_analysis.misconceptions.length > 0 && (
                <div className="participant-summary-section">
                  <h3>可以再複習</h3>
                  <ul>
                    {sessionSummary.learning_analysis.misconceptions.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            <div className="participant-summary-pending">
              <Sparkles size={22} />
              <p>老師正在整理本次課程重點，完成後會自動顯示在這裡。</p>
            </div>
          )}
        </section>
        {sharedContents.length > 0 && (
          <section className="panel participant-ended-shared-panel">
            <SharedContentPanel
              contents={sharedContents}
              defaultExpanded
              heading="課堂文字與連結"
            />
          </section>
        )}
      </main>
    )
  }

  return (
    <main className="participant-page">
      <SetupNotice />
      <StudentSocialLinks />
      <header className="participant-header">
        <div>
          <h1>{participant?.name || '與會者'}</h1>
        </div>
      </header>
      <SharedContentPanel contents={sharedContents} />
      {screenshot && <img alt="講者派送圖片" className="participant-image" src={screenshot.public_url} />}
      <ParticipantQuestionView answer={answer} question={question} onSubmit={submitAnswer} />
      {session?.exit_ticket_prompt && session.exit_ticket_category && (
        <ExitTicketForm
          busy={exitTicketBusy}
          category={session.exit_ticket_category}
          prompt={session.exit_ticket_prompt}
          ticket={exitTicket}
          onSubmit={submitExitTicket}
        />
      )}
      <form className="panel message-form" onSubmit={sendMessage}>
        <label>
          送出問題或回饋
          <textarea
            value={message}
            maxLength={36}
            onChange={(event) => setMessage(Array.from(event.target.value).slice(0, 36).join(''))}
            placeholder="送出後這訊息會即時出現在講者的畫面上，上限36個字"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit"><Send size={18} />送出</button>
      </form>
      <LotteryOverlay event={lotteryEvent} participantId={participant?.id} />
      <BuzzerOverlay
        busy={buzzerBusy}
        event={buzzerEvent}
        participantId={participant?.id}
        onBuzz={claimBuzzer}
      />
    </main>
  )
}
