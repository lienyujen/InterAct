import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ParticipantQuestionView } from '../components/ParticipantQuestionView'
import { SetupNotice } from '../components/SetupNotice'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Answer, Participant, Question, Screenshot, Session } from '../types'

export function ParticipantPage() {
  const { sessionId = '' } = useParams()
  const participantId = localStorage.getItem(`interact_participant_${sessionId}`)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const loadAll = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId || !participantId) return
    const supabase = requireSupabase()
    const [{ data: sessionData }, { data: participantData }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.from('participants').select('*').eq('id', participantId).single(),
    ])
    const nextSession = sessionData as Session | null
    setSession(nextSession)
    setParticipant(participantData as Participant | null)

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
    }
  }, [participantId, sessionId])

  useEffect(() => {
    if (!participantId) navigate(`/join/${sessionId}`)
  }, [navigate, participantId, sessionId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`participant:${sessionId}:${participantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: `participant_id=eq.${participantId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screenshots', filter: `session_id=eq.${sessionId}` }, loadAll)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadAll, participantId, sessionId])

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const content = message.trim()
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
      setError(err instanceof Error ? err.message : '送出失敗')
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
      setError(err instanceof Error ? err.message : '作答失敗，可能已經提交過。')
    }
  }

  return (
    <main className="participant-page">
      <SetupNotice />
      <header className="participant-header">
        <div>
          <h1>{participant?.name || '與會者'}</h1>
        </div>
      </header>
      {screenshot && <img alt="講者派送圖片" className="participant-image" src={screenshot.public_url} />}
      <ParticipantQuestionView answer={answer} question={question} onSubmit={submitAnswer} />
      <form className="panel message-form" onSubmit={sendMessage}>
        <label>
          送出問題或回饋
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="送出後這則訊息會即時出現在講者的畫面上"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit">送出</button>
      </form>
    </main>
  )
}
