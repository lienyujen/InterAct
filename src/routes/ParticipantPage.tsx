import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ParticipantQuestionView } from '../components/ParticipantQuestionView'
import { BuzzerOverlay } from '../components/BuzzerOverlay'
import { ExitTicketForm } from '../components/ExitTicketForm'
import { LotteryOverlay } from '../components/LotteryOverlay'
import { SharedContentPanel } from '../components/SharedContentPanel'
import { SetupNotice } from '../components/SetupNotice'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { useSessionPresence } from '../lib/useSessionPresence'
import type { Answer, BuzzerSessionEvent, ExitTicket, LotterySessionEvent, Participant, Question, Screenshot, Session, SessionEvent, SharedContent } from '../types'

export function ParticipantPage() {
  const { sessionId = '' } = useParams()
  const participantId = localStorage.getItem(`interact_participant_${sessionId}`)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)
  const [exitTicket, setExitTicket] = useState<ExitTicket | null>(null)
  const [sharedContents, setSharedContents] = useState<SharedContent[]>([])
  const [lotteryEvent, setLotteryEvent] = useState<LotterySessionEvent | null>(null)
  const [buzzerEvent, setBuzzerEvent] = useState<BuzzerSessionEvent | null>(null)
  const [buzzerBusy, setBuzzerBusy] = useState(false)
  const [exitTicketBusy, setExitTicketBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  useSessionPresence(sessionId, participant)

  const loadAll = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId || !participantId) return
    const supabase = requireSupabase()
    const [{ data: sessionData }, { data: participantData }, { data: exitTicketData }, { data: sharedContentData }, { data: buzzerData }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.from('participants').select('*').eq('id', participantId).single(),
      supabase.from('exit_tickets').select('*').eq('session_id', sessionId).eq('participant_id', participantId).maybeSingle(),
      supabase.from('shared_contents').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(20),
      supabase.from('session_events').select('*').eq('session_id', sessionId).eq('event_type', 'buzzer').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    const nextSession = sessionData as Session | null
    setSession(nextSession)
    setParticipant(participantData as Participant | null)
    setExitTicket((exitTicketData as ExitTicket | null) || null)
    setSharedContents((sharedContentData || []) as SharedContent[])
    setBuzzerEvent((buzzerData as BuzzerSessionEvent | null) || null)

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

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const content = Array.from(message.trim()).slice(0, 36).join('')
    if (!participant || !content) return
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
      setError(err instanceof Error ? err.message : '????')
    }
  }

  async function submitAnswer(value: string | string[]) {
    if (!participant || !question) return
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
      setError(err instanceof Error ? err.message : '?????????????')
    }
  }

  async function submitExitTicket(value: { responseText: string; rating: number }) {
    if (!participant || !session?.exit_ticket_prompt) return
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
      setError(err instanceof Error ? err.message : 'Exit Ticket ?????????????')
    } finally {
      setExitTicketBusy(false)
    }
  }

  async function claimBuzzer() {
    if (!participant || !buzzerEvent || buzzerEvent.payload.finalized) return
    setBuzzerBusy(true)
    setError('')
    try {
      const { data, error: claimError } = await requireSupabase().functions.invoke('participant-action', {
        body: {
          action: 'claim_buzzer',
          sessionId,
          participantId: participant.id,
          eventId: buzzerEvent.id,
        },
      })
      if (claimError) throw claimError
      if (!data?.event) throw new Error(data?.message || '?????')
      setBuzzerEvent(data.event as BuzzerSessionEvent)
    } catch (err) {
      setError(err instanceof Error ? err.message : '???????????')
      throw err
    } finally {
      setBuzzerBusy(false)
    }
  }

  return (
    <main className="participant-page">
      <SetupNotice />
      <header className="participant-header">
        <div>
          <h1>{participant?.name || '???'}</h1>
        </div>
      </header>
      <SharedContentPanel contents={sharedContents} />
      {screenshot && <img alt="??????" className="participant-image" src={screenshot.public_url} />}
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
          ???????
          <textarea
            value={message}
            maxLength={36}
            onChange={(event) => setMessage(Array.from(event.target.value).slice(0, 36).join(''))}
            placeholder="?????????????????????36??"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">??</button>
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
