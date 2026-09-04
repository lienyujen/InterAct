import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { BookOpen, PartyPopper, Send, Sparkles, Waves } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ParticipantQuestionView } from '../components/ParticipantQuestionView'
import { ParticipantQuestionHistory } from '../components/ParticipantQuestionHistory'
import { ParticipantCustomQuiz } from '../components/ParticipantCustomQuiz'
import type { QuizSubmission } from '../components/ParticipantCustomQuiz'
import { ParticipantInterpretationAudio } from '../components/ParticipantInterpretationAudio'
import { ParticipantFileUpload, ParticipantSharedFiles } from '../components/ParticipantFilePanel'
import { BuzzerOverlay } from '../components/BuzzerOverlay'
import { ExitTicketForm } from '../components/ExitTicketForm'
import { LotteryOverlay } from '../components/LotteryOverlay'
import { SharedContentPanel } from '../components/SharedContentPanel'
import { SetupNotice } from '../components/SetupNotice'
import { StudentSocialLinks } from '../components/StudentSocialLinks'
import { ParticipantLanguageSwitcher } from '../components/ParticipantLanguageSwitcher'
import { isBuzzerAccepting } from '../lib/buzzer'
import {
  MESSAGE_MAX_CJK_CHARACTERS,
  MESSAGE_MAX_ENGLISH_WORDS,
  MESSAGE_MAX_RAW_CHARACTERS,
  messageFitsLimit,
  messageUsage,
} from '../lib/messageLimit'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { useSessionPresence } from '../lib/useSessionPresence'
import { trackParticipantPresence } from '../lib/participantPresence'
import { participantLocaleFromStorage, participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { AiSummary, Answer, AudioResponse, BuzzerSessionEvent, ExitTicket, LotterySessionEvent, Participant, ParticipantQuizData, Question, Screenshot, Session, SessionAnalysis, SessionEvent, SharedContent } from '../types'

async function participantFunctionMessage(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context
  if (context) {
    try {
      const payload = await context.clone().json() as { message?: unknown }
      if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
    } catch {
      // Use the localized fallback for non-JSON gateway errors.
    }
  }
  return fallback
}

export function ParticipantPage() {
  const { sessionId = '' } = useParams()
  const participantId = localStorage.getItem(`interact_participant_${sessionId}`)
  const participantToken = localStorage.getItem(`interact_participant_token_${sessionId}`)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [audioResponse, setAudioResponse] = useState<AudioResponse | null>(null)
  const [audioBusy, setAudioBusy] = useState(false)
  const [quizData, setQuizData] = useState<ParticipantQuizData | null>(null)
  const [quizBusy, setQuizBusy] = useState(false)
  const [quizLoadError, setQuizLoadError] = useState('')
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)
  const [exitTicket, setExitTicket] = useState<ExitTicket | null>(null)
  const [sessionSummary, setSessionSummary] = useState<SessionAnalysis | null>(null)
  const [sharedContents, setSharedContents] = useState<SharedContent[]>([])
  const [historyQuestions, setHistoryQuestions] = useState<Question[]>([])
  const [historyAnswers, setHistoryAnswers] = useState<Answer[]>([])
  const [historyScreenshots, setHistoryScreenshots] = useState<Record<string, Screenshot>>({})
  const [historyAudioResponses, setHistoryAudioResponses] = useState<Record<string, AudioResponse | null>>({})
  const [historyQuizData, setHistoryQuizData] = useState<Record<string, ParticipantQuizData | null>>({})
  const [historyLoadingQuestionIds, setHistoryLoadingQuestionIds] = useState<Set<string>>(new Set())
  const [lotteryEvent, setLotteryEvent] = useState<LotterySessionEvent | null>(null)
  const [buzzerEvent, setBuzzerEvent] = useState<BuzzerSessionEvent | null>(null)
  const [buzzerBusy, setBuzzerBusy] = useState(false)
  const [exitTicketBusy, setExitTicketBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [sessionChecked, setSessionChecked] = useState(false)
  const [locale, setLocale] = useState<ParticipantLocale>(participantLocaleFromStorage)
  const loadSequence = useRef(0)
  const loadedQuizQuestionId = useRef('')
  const navigate = useNavigate()
  const location = useLocation()
  useSessionPresence(sessionId, session?.status === 'active' ? participant : null)

  // Presence in the channel is live-only; this is what the report reads later.
  useEffect(() => {
    if (session?.status !== 'active' || !participant?.id || !participantToken) return
    return trackParticipantPresence({ sessionId, participantId: participant.id, participantToken })
  }, [participant?.id, participantToken, session?.status, sessionId])
  const localizedSummary = locale === 'en' ? sessionSummary?.translations?.en || sessionSummary : sessionSummary
  const participantName = participant?.name || localStorage.getItem(`interact_name_${sessionId}`) || ''

  function changeLocale(nextLocale: ParticipantLocale) {
    localStorage.setItem('interact_participant_locale', nextLocale)
    setLocale(nextLocale)
  }

  const loadAll = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId || !participantId) return
    const requestId = ++loadSequence.current
    const supabase = requireSupabase()
    const [{ data: sessionData }, { data: participantData }, { data: exitTicketData }, { data: sharedContentData }, { data: buzzerData }, { data: allQuestions }, { data: allAnswers }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.from('participants').select('*').eq('id', participantId).single(),
      supabase.from('exit_tickets').select('*').eq('session_id', sessionId).eq('participant_id', participantId).maybeSingle(),
      supabase.from('shared_contents').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }),
      supabase.from('session_events').select('*').eq('session_id', sessionId).eq('event_type', 'buzzer').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('questions').select('*').eq('session_id', sessionId).order('created_at'),
      supabase.from('answers').select('*').eq('session_id', sessionId).eq('participant_id', participantId).order('submitted_at'),
    ])
    if (requestId !== loadSequence.current) return
    const nextSession = sessionData as Session | null
    setSession(nextSession)
    setSessionChecked(true)
    setParticipant(participantData as Participant | null)
    setExitTicket((exitTicketData as ExitTicket | null) || null)
    setSharedContents((sharedContentData || []) as SharedContent[])
    setBuzzerEvent((buzzerData as BuzzerSessionEvent | null) || null)
    const participantAnswers = (allAnswers || []) as Answer[]
    const answeredQuestionIds = new Set(participantAnswers.map((item) => item.question_id))
    const answeredQuestions = ((allQuestions || []) as Question[]).filter((item) => answeredQuestionIds.has(item.id))
    setHistoryAnswers(participantAnswers)
    setHistoryQuestions(answeredQuestions)

    const screenshotIds = [...new Set(answeredQuestions.map((item) => item.screenshot_id).filter((id): id is string => Boolean(id)))]
    if (screenshotIds.length) {
      const { data: historyScreenshotData } = await supabase.from('screenshots').select('*').in('id', screenshotIds)
      if (requestId !== loadSequence.current) return
      setHistoryScreenshots(Object.fromEntries(((historyScreenshotData || []) as Screenshot[]).map((item) => [item.id, item])))
    } else {
      setHistoryScreenshots({})
    }

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
      if (requestId !== loadSequence.current) return
      const nextQuestion = questionData as Question | null
      setQuestion(nextQuestion)
      setAnswer((answerData as Answer | null) || null)
      if (nextQuestion?.type === 'custom_quiz') {
        if (loadedQuizQuestionId.current !== nextQuestion.id) setQuizData(null)
      }

      if (nextQuestion && ['pronunciation', 'oral_response'].includes(nextQuestion.type) && participantToken) {
        const { data: recordingData } = await supabase.functions.invoke('participant-action', {
          body: {
            action: 'get_recording_result',
            sessionId,
            participantId,
            participantToken,
            questionId: nextQuestion.id,
          },
        })
        if (requestId !== loadSequence.current) return
        setAudioResponse((recordingData?.response as AudioResponse | null) || null)
      } else {
        setAudioResponse(null)
      }

      if (nextQuestion?.type === 'custom_quiz' && participantToken) {
        const { data: loadedQuiz, error: quizError } = await supabase.functions.invoke('participant-action', {
          body: { action: 'get_custom_quiz', sessionId, participantId, participantToken, questionId: nextQuestion.id },
        })
        if (requestId !== loadSequence.current) return
        if (quizError) {
          setQuizData(null)
          setQuizLoadError(await participantFunctionMessage(
            quizError,
            locale === 'en' ? 'Unable to load this quiz. Please refresh or scan the QR code again.' : '無法載入測驗，請重新整理；若仍無法顯示，請重新掃描 QR Code 加入。',
          ))
        } else if (loadedQuiz?.generating) {
          setQuizData(null)
          setQuizLoadError('')
        } else {
          loadedQuizQuestionId.current = nextQuestion.id
          setQuizData((loadedQuiz as ParticipantQuizData | null) || null)
          setQuizLoadError('')
        }
      } else {
        loadedQuizQuestionId.current = ''
        setQuizData(null)
        setQuizLoadError(nextQuestion?.type === 'custom_quiz'
          ? (locale === 'en' ? 'Your participant access has expired. Please scan the QR code again.' : '學員權限已失效，請重新掃描 QR Code 加入。')
          : '')
      }

      if (nextQuestion?.screenshot_id) {
        const { data } = await supabase.from('screenshots').select('*').eq('id', nextQuestion.screenshot_id).single()
        if (requestId !== loadSequence.current) return
        setScreenshot(data as Screenshot | null)
      } else {
        setScreenshot(null)
      }
    } else {
      setQuestion(null)
      setAnswer(null)
      setAudioResponse(null)
      loadedQuizQuestionId.current = ''
      setQuizData(null)
      setQuizLoadError('')
      setScreenshot(null)
    }
  }, [locale, participantId, participantToken, sessionId])

  const loadHistoryDetails = useCallback(async (historyQuestion: Question) => {
    if (!participantId || !participantToken || !['custom_quiz', 'pronunciation', 'oral_response'].includes(historyQuestion.type)) return
    if (historyQuizData[historyQuestion.id] !== undefined || historyAudioResponses[historyQuestion.id] !== undefined) return
    setHistoryLoadingQuestionIds((current) => new Set(current).add(historyQuestion.id))
    try {
      const action = historyQuestion.type === 'custom_quiz' ? 'get_custom_quiz' : 'get_recording_result'
      const { data, error: detailError } = await requireSupabase().functions.invoke('participant-action', {
        body: { action, sessionId, participantId, participantToken, questionId: historyQuestion.id },
      })
      if (detailError) throw detailError
      if (historyQuestion.type === 'custom_quiz') {
        setHistoryQuizData((current) => ({ ...current, [historyQuestion.id]: (data as ParticipantQuizData | null) || null }))
      } else {
        setHistoryAudioResponses((current) => ({ ...current, [historyQuestion.id]: (data?.response as AudioResponse | null) || null }))
      }
    } catch {
      if (historyQuestion.type === 'custom_quiz') setHistoryQuizData((current) => ({ ...current, [historyQuestion.id]: null }))
      else setHistoryAudioResponses((current) => ({ ...current, [historyQuestion.id]: null }))
    } finally {
      setHistoryLoadingQuestionIds((current) => {
        const next = new Set(current)
        next.delete(historyQuestion.id)
        return next
      })
    }
  }, [historyAudioResponses, historyQuizData, participantId, participantToken, sessionId])

  useEffect(() => {
    if (!participantId) navigate(`/join/${sessionId}${location.search}`)
  }, [location.search, navigate, participantId, sessionId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (quizData?.attempt?.status !== 'grading') return
    const timer = window.setInterval(() => void loadAll(), 2000)
    return () => window.clearInterval(timer)
  }, [loadAll, quizData?.attempt?.status])

  useEffect(() => {
    if (question?.type !== 'custom_quiz' || quizData || quizLoadError) return
    const timer = window.setInterval(() => void loadAll(), 1500)
    return () => window.clearInterval(timer)
  }, [loadAll, question?.type, quizData, quizLoadError])

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
    const content = message.trim()
    if (!participant || session?.status !== 'active' || !content) return
    if (!messageFitsLimit(content)) {
      setError(`彈幕上限為 ${MESSAGE_MAX_CJK_CHARACTERS} 個中文字或 ${MESSAGE_MAX_ENGLISH_WORDS} 個英文單字。`)
      return
    }
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

  async function submitCustomQuiz(answers: QuizSubmission) {
    if (!participant || !participantToken || !question || question.type !== 'custom_quiz') return
    setQuizBusy(true)
    setError('')
    try {
      const { data, error: submitError } = await requireSupabase().functions.invoke('participant-action', {
        body: { action: 'submit_custom_quiz', sessionId, participantId: participant.id, participantToken, questionId: question.id, answers },
      })
      if (submitError) throw submitError
      if (!data?.attempt) throw new Error(data?.message || '自訂測驗送出失敗。')
      await loadAll()
    } catch (caught) {
      setError(await participantFunctionMessage(caught, '自訂測驗送出失敗。'))
    } finally {
      setQuizBusy(false)
    }
  }

  async function retryCustomQuiz() {
    if (!participant || !participantToken || !question || question.type !== 'custom_quiz') return
    setQuizBusy(true)
    setError('')
    try {
      const { error: retryError } = await requireSupabase().functions.invoke('participant-action', {
        body: { action: 'retry_custom_quiz_grading', sessionId, participantId: participant.id, participantToken, questionId: question.id },
      })
      if (retryError) throw retryError
      await loadAll()
    } catch (caught) {
      setError(await participantFunctionMessage(caught, '無法重新評分。'))
    } finally {
      setQuizBusy(false)
    }
  }

  async function submitAudio(file: File, durationMs: number) {
    if (!participant || !participantToken || !question || !['pronunciation', 'oral_response'].includes(question.type)) {
      setError('找不到錄音權限，請重新掃描 QR Code 加入場次。')
      return
    }
    setAudioBusy(true)
    setError('')
    try {
      const supabase = requireSupabase()
      const { data: prepared, error: prepareError } = await supabase.functions.invoke('participant-action', {
        body: {
          action: 'prepare_recording_upload',
          sessionId,
          participantId: participant.id,
          participantToken,
          questionId: question.id,
          fileSize: file.size,
        },
      })
      if (prepareError) throw prepareError
      if (!prepared?.recordingId || !prepared?.storagePath || !prepared?.uploadToken) {
        throw new Error(prepared?.message || '無法準備錄音上傳。')
      }
      const { error: uploadError } = await supabase.storage
        .from('interact-recordings')
        .uploadToSignedUrl(prepared.storagePath, prepared.uploadToken, file, { contentType: 'audio/wav' })
      if (uploadError) throw uploadError

      const { data, error: submitError } = await supabase.functions.invoke('participant-action', {
        body: {
          action: 'submit_recording',
          sessionId,
          participantId: participant.id,
          participantToken,
          questionId: question.id,
          recordingId: prepared.recordingId,
          storagePath: prepared.storagePath,
          durationMs,
        },
      })
      if (submitError) throw submitError
      if (!data?.response) throw new Error(data?.message || '錄音送出失敗。')
      await loadAll()
    } catch (caught) {
      setError(await participantFunctionMessage(caught, '錄音送出失敗，請稍後再試。'))
    } finally {
      setAudioBusy(false)
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
      setError(await participantFunctionMessage(err, '搶答失敗，請稍後再試。'))
      throw err
    } finally {
      setBuzzerBusy(false)
    }
  }

  if (session?.status === 'ended') {
    return (
      <main className="participant-page participant-ended-page">
        <ParticipantLanguageSwitcher locale={locale} onChange={changeLocale} />
        <SetupNotice />
        <StudentSocialLinks />
        <section className="participant-ended-hero">
          <span className="participant-ended-icon"><PartyPopper size={34} /></span>
          <p className="eyebrow">{participantText(locale, 'courseEnded')}</p>
          <h1>{participantText(locale, 'classDismissed')}</h1>
          <p>{participantName ? `${participantName}${locale === 'en' ? ', ' : '，'}${participantText(locale, 'thankYou')}` : participantText(locale, 'thankYou')}</p>
        </section>
        {sessionSummary && (
          <section className="panel participant-summary-panel" aria-live="polite">
            <div className="participant-summary-heading">
              <span className="heading-icon"><Sparkles size={18} /></span>
              <div>
                <p className="eyebrow">{participantText(locale, 'aiSummary')}</p>
                <h2>{participantText(locale, 'todayHighlights')}</h2>
              </div>
            </div>
            <div className="participant-summary-content">
              {localizedSummary && localizedSummary.lesson_key_points.length > 0 && (
                <div className="participant-summary-section">
                  <h3><BookOpen size={18} />{participantText(locale, 'lessonKeyPoints')}</h3>
                  <ul>
                    {localizedSummary.lesson_key_points.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}
              <p className="participant-summary-lead">{localizedSummary?.executive_summary}</p>
              <div className="participant-summary-section">
                <h3><BookOpen size={18} />{participantText(locale, 'learningReview')}</h3>
                <p>{localizedSummary?.learning_analysis.overall_understanding}</p>
              </div>
              {localizedSummary && localizedSummary.learning_analysis.strengths.length > 0 && (
                <div className="participant-summary-section">
                  <h3>{participantText(locale, 'strengths')}</h3>
                  <ul>
                    {localizedSummary.learning_analysis.strengths.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}
              {localizedSummary && localizedSummary.learning_analysis.misconceptions.length > 0 && (
                <div className="participant-summary-section">
                  <h3>{participantText(locale, 'reviewMore')}</h3>
                  <ul>
                    {localizedSummary.learning_analysis.misconceptions.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>
              )}
            </div>
          </section>
        )}
        {sharedContents.length > 0 && (
          <section className="panel participant-ended-shared-panel">
            <SharedContentPanel
              contents={sharedContents}
              defaultExpanded
              heading={participantText(locale, 'sharedResources')}
              locale={locale}
            />
          </section>
        )}
        {/* Files stay downloadable after class until the presenter deletes the session. */}
        <ParticipantSharedFiles locale={locale} sessionId={sessionId} />
        <ParticipantQuestionHistory
          answers={historyAnswers}
          audioResponses={historyAudioResponses}
          loadingQuestionIds={historyLoadingQuestionIds}
          locale={locale}
          questions={historyQuestions}
          quizData={historyQuizData}
          screenshots={historyScreenshots}
          onLoadDetails={loadHistoryDetails}
        />
      </main>
    )
  }

  if (sessionChecked && !session) {
    return (
      <main className="participant-page participant-ended-page">
        <ParticipantLanguageSwitcher locale={locale} onChange={changeLocale} />
        <SetupNotice />
        <section className="participant-ended-hero">
          <span className="participant-ended-icon"><Waves size={34} /></span>
          <h1>{participantText(locale, 'sessionGoneTitle')}</h1>
          <p>{participantText(locale, 'sessionGoneMessage')}</p>
        </section>
      </main>
    )
  }

  return (
    <main className="participant-page">
      <ParticipantLanguageSwitcher locale={locale} onChange={changeLocale} />
      <SetupNotice />
      <StudentSocialLinks />
      <header className="participant-header">
        <h1>
          <strong>{participant?.name || participantText(locale, 'attendee')}</strong>{locale === 'en' ? participantText(locale, 'welcome') : `，${participantText(locale, 'welcome')}`}{session?.title || participantText(locale, 'session')}
        </h1>
      </header>
      {session && (
        <ParticipantInterpretationAudio
          enabled={session.interpretation_enabled && session.interpretation_audio_enabled}
          languages={session.interpretation_languages}
          sessionId={sessionId}
          locale={locale}
        />
      )}
      <ParticipantSharedFiles locale={locale} sessionId={sessionId} />
      {question?.type === 'file_upload' && participant && participantToken && (
        <ParticipantFileUpload
          active={question.status === 'active'}
          imageUrl={screenshot?.public_url || null}
          locale={locale}
          participantId={participant.id}
          participantToken={participantToken}
          promptText={question.prompt_text}
          questionId={question.id}
          sessionId={sessionId}
        />
      )}
      {session?.exit_ticket_prompt && session.exit_ticket_category && (
        <div className="participant-exit-ticket-priority">
          <ExitTicketForm
            busy={exitTicketBusy}
            category={session.exit_ticket_category}
            prompt={locale === 'en' ? session.exit_ticket_prompt_en || session.exit_ticket_prompt : session.exit_ticket_prompt}
            ticket={exitTicket}
            locale={locale}
            onSubmit={submitExitTicket}
          />
        </div>
      )}
      <SharedContentPanel contents={sharedContents} locale={locale} />
      {screenshot && question?.type !== 'file_upload' && (
        <img alt={participantText(locale, 'imageAlt')} className="participant-image" src={screenshot.public_url} />
      )}
      {question?.type === 'custom_quiz' ? (quizData ? (
        <ParticipantCustomQuiz data={quizData} busy={quizBusy} locale={locale} onRetry={retryCustomQuiz} onSubmit={submitCustomQuiz} />
      ) : (
        <section className="panel participant-question quiz-loading-panel" aria-live="polite">
          <h2>{locale === 'en' ? 'Custom quiz' : '自訂測驗'}</h2>
          <p className={quizLoadError ? 'error' : 'muted'}>{quizLoadError || (locale === 'en' ? 'Preparing questions, please wait…' : '出題中，請稍候')}</p>
          {quizLoadError && <button type="button" onClick={() => void loadAll()}>{locale === 'en' ? 'Try again' : '重新載入'}</button>}
        </section>
      )) : <ParticipantQuestionView
        answer={answer}
        audioBusy={audioBusy}
        audioResponse={audioResponse}
        question={question}
        locale={locale}
        onSubmit={submitAnswer}
        onSubmitAudio={submitAudio}
      />}
      <ParticipantQuestionHistory
        activeQuestionId={question?.id}
        answers={historyAnswers}
        audioResponses={historyAudioResponses}
        loadingQuestionIds={historyLoadingQuestionIds}
        locale={locale}
        questions={historyQuestions}
        quizData={historyQuizData}
        screenshots={historyScreenshots}
        onLoadDetails={loadHistoryDetails}
      />
      <form className="panel message-form" onSubmit={sendMessage}>
        <label>
          {participantText(locale, 'sendFeedback')}
          <textarea
            value={message}
            maxLength={MESSAGE_MAX_RAW_CHARACTERS}
            onChange={(event) => {
              setMessage(event.target.value)
              if (error) setError('')
            }}
            placeholder={participantText(locale, 'messagePlaceholder')}
          />
        </label>
        <p className={`message-limit${message && !messageFitsLimit(message) ? ' over-limit' : ''}`}>
          {participantText(locale, 'limit')}
          {message && ` · ${participantText(locale, 'used')} ${Math.ceil(messageUsage(message).units)}/${MESSAGE_MAX_CJK_CHARACTERS}`}
        </p>
        {error && <p className="error">{error}</p>}
        <button disabled={!message.trim() || !messageFitsLimit(message)} type="submit"><Send size={18} />{participantText(locale, 'send')}</button>
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
