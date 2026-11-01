import { useCallback, useEffect, useRef, useState } from 'react'
import { classroomRetryDelay, createClassroomReadCache } from '../lib/classroomReadCache'
import type { FormEvent } from 'react'
import { BookOpen, Coffee, Hand, PartyPopper, Send, Sparkles, Waves } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ParticipantQuestionView } from '../components/ParticipantQuestionView'
import { ParticipantBoard } from '../components/ParticipantBoard'
import { ParticipantQuestionHistory } from '../components/ParticipantQuestionHistory'
import { CameraPollResult } from '../components/CameraPollResult'
import type { SubmittedFile } from '../components/ParticipantQuestionHistory'
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
import { useMyStanding } from '../lib/standings'
import { useSessionPresence } from '../lib/useSessionPresence'
import { trackParticipantPresence } from '../lib/participantPresence'
import { usePageVisibility } from '../lib/usePageVisibility'
import { createCoalescedLoader } from '../lib/coalescedLoad'
import { createRevisionGuard } from '../lib/realtimeSnapshot'
import { participantLocaleFromStorage, participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { AiSummary, Answer, AudioResponse, BuzzerSessionEvent, ExitTicket, LotterySessionEvent, Participant, ParticipantQuizData, Question, QuestionAnalysis, Screenshot, Session, SessionAnalysis, SessionEvent, SharedContent } from '../types'

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

function quizLoadCanRetry(error: unknown) {
  const status = (error as { context?: { status?: number } } | null)?.context?.status
  return !status || status === 408 || status === 429 || status >= 500
}

export function ParticipantPage() {
  const { sessionId = '' } = useParams()
  const participantId = localStorage.getItem(`interact_participant_${sessionId}`)
  const participantToken = localStorage.getItem(`interact_participant_token_${sessionId}`)
  const [participant, setParticipant] = useState<Participant | null>(null)
  const participantRevision = useRef(createRevisionGuard())
  const handMutation = useRef(false)
  const readCache = useRef(createClassroomReadCache())
  const participantRef = useRef(participant)
  participantRef.current = participant
  const ownRowLoader = useRef(createCoalescedLoader())
  const handSyncTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => { participantRevision.current.changed() }, [participantId, sessionId])
  const [handBusy, setHandBusy] = useState(false)
  // The same figure the teacher's list shows, worked out on their machine and
  // sent here — see the note in lib/standings.
  const [session, setSession] = useState<Session | null>(null)
  const pageVisible = usePageVisibility()
  const liveSessionId = pageVisible && session?.status === 'active' ? sessionId : ''
  const refreshParticipantRow = useCallback(() => ownRowLoader.current(async () => {
    if (!isSupabaseConfigured || !participantId || !sessionId || navigator.onLine === false || document.visibilityState === 'hidden') return
    const revision = participantRevision.current.current()
    const { data, error } = await requireSupabase().from('participants').select('*').eq('id', participantId).eq('session_id', sessionId).maybeSingle()
    if (error || !data || handMutation.current || !participantRevision.current.accepts(revision)) return
    readCache.current.invalidate('participants')
    participantRevision.current.changed()
    setParticipant(data as Participant)
  }), [participantId, sessionId])
  const syncLoweredHand = useCallback(() => {
    if (!participantRef.current?.hand_raised_at || handSyncTimer.current !== null) return
    // Invalidation only: an unauthenticated broadcast cannot lower a hand.
    handSyncTimer.current = setTimeout(() => {
      handSyncTimer.current = null
      void refreshParticipantRow()
    }, 100 + Math.random() * 300)
  }, [refreshParticipantRow])
  const standing = useMyStanding(liveSessionId, participant?.id || null, syncLoweredHand)
  useEffect(() => () => { if (handSyncTimer.current !== null) clearTimeout(handSyncTimer.current) }, [])
  const [question, setQuestion] = useState<Question | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [audioResponse, setAudioResponse] = useState<AudioResponse | null>(null)
  const [audioBusy, setAudioBusy] = useState(false)
  const [quizData, setQuizData] = useState<ParticipantQuizData | null>(null)
  const [quizBusy, setQuizBusy] = useState(false)
  const [orderedBusy, setOrderedBusy] = useState(false)
  const [quizLoadError, setQuizLoadError] = useState('')
  const [quizLoadRetryable, setQuizLoadRetryable] = useState(true)
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)
  // The open 討論板, which outlives the question the class is currently on.
  const [boardQuestion, setBoardQuestion] = useState<Question | null>(null)
  const [boardImageUrl, setBoardImageUrl] = useState<string | null>(null)
  const [exitTicket, setExitTicket] = useState<ExitTicket | null>(null)
  const [sessionSummary, setSessionSummary] = useState<SessionAnalysis | null>(null)
  const [sharedContents, setSharedContents] = useState<SharedContent[]>([])
  const [historyQuestions, setHistoryQuestions] = useState<Question[]>([])
  // Keyed by question id, so it survives every reload and every new question.
  const [questionAnalyses, setQuestionAnalyses] = useState<Record<string, QuestionAnalysis>>({})
  const [historyAnswers, setHistoryAnswers] = useState<Answer[]>([])
  const [historyScreenshots, setHistoryScreenshots] = useState<Record<string, Screenshot>>({})
  const [historyAudioResponses, setHistoryAudioResponses] = useState<Record<string, AudioResponse | null>>({})
  const [historyQuizData, setHistoryQuizData] = useState<Record<string, ParticipantQuizData | null>>({})
  const [historyFiles, setHistoryFiles] = useState<Record<string, SubmittedFile[]>>({})
  // 排序題 and 配對題 keep their answer off the question row so the class
  // cannot read it before answering; this is how it comes back afterwards.
  const [historyKeys, setHistoryKeys] = useState<Record<string, string[]>>({})
  const [historyLoadingQuestionIds, setHistoryLoadingQuestionIds] = useState<Set<string>>(new Set())
  const [lotteryEvent, setLotteryEvent] = useState<LotterySessionEvent | null>(null)
  const [buzzerEvent, setBuzzerEvent] = useState<BuzzerSessionEvent | null>(null)
  const [buzzerBusy, setBuzzerBusy] = useState(false)
  const [exitTicketBusy, setExitTicketBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageBusy, setMessageBusy] = useState(false)
  const messageSending = useRef(false)
  const [error, setError] = useState('')
  const [sessionChecked, setSessionChecked] = useState(false)
  const sessionGone = sessionChecked && !session
  const [locale, setLocale] = useState<ParticipantLocale>(participantLocaleFromStorage)
  const loadSequence = useRef(0)
  const goneSessionId = useRef('')
  const markSessionGone = useCallback(() => {
    goneSessionId.current = sessionId
    loadSequence.current++
    setSession(null)
    setSessionChecked(true)
    setParticipant(null)
    setQuestion(null)
    setQuizData(null)
  }, [sessionId])
  const coalescedLoad = useRef(createCoalescedLoader())
  const loadedQuizQuestionId = useRef('')
  const navigate = useNavigate()
  const location = useLocation()
  // Also tells the class whether anyone is at the front of the room.
  const { presenterOnline } = useSessionPresence(liveSessionId, {
    role: 'participant',
    participant: session?.status === 'active' ? participant : null,
  })
  // The teacher's danmaku switch. Off means the field greys out rather than
  // disappearing — a student who has just typed something should see why it
  // will not send, which is not the same situation as 下課中, where there is
  // nobody there at all and the field goes away.
  const danmakuOpen = session?.danmaku_enabled !== false

  // Only once it is known. Until then nothing is said, so a page that has just
  // opened never flashes 下課中 at a class that is running.
  const onBreak = presenterOnline === false

  // Presence in the channel is live-only; this is what the report reads later.
  useEffect(() => {
    if (session?.status !== 'active' || !participant?.id || !participantToken) return
    return trackParticipantPresence({ sessionId, participantId: participant.id, participantToken,
      captureRevision: participantRevision.current.current,
      onParticipantState: (state, revision) => {
        if (state.session_id !== sessionId || handMutation.current || !participantRevision.current.accepts(revision)) return
        readCache.current.invalidate('participants')
        participantRevision.current.changed()
        setParticipant(current => current ? { ...current, ...state } : current)
      },
    })
  }, [participant?.id, participantToken, session?.status, sessionId])
  const localizedSummary = locale === 'en' ? sessionSummary?.translations?.en || sessionSummary : sessionSummary
  const participantName = participant?.name || localStorage.getItem(`interact_name_${sessionId}`) || ''

  function changeLocale(nextLocale: ParticipantLocale) {
    localStorage.setItem('interact_participant_locale', nextLocale)
    setLocale(nextLocale)
  }

  const loadAll = useCallback(() => coalescedLoad.current(async () => {
    if (!isSupabaseConfigured || !sessionId || !participantId || goneSessionId.current === sessionId || navigator.onLine === false) return
    const requestId = ++loadSequence.current
    const participantReadRevision = participantRevision.current.current()
    const supabase = requireSupabase()
    const cache = readCache.current
    cache.scope(JSON.stringify([sessionId, participantId, participantToken, locale]))
    const read = cache.read.bind(cache)
    const initial = await Promise.all([
      read('sessions', () => supabase.from('sessions').select('*').eq('id', sessionId).maybeSingle(), 15_000),
      read('participants', () => supabase.from('participants').select('*').eq('id', participantId).single(), 30_000),
      read('exit_tickets', () => supabase.from('exit_tickets').select('*').eq('session_id', sessionId).eq('participant_id', participantId).maybeSingle()),
      read('shared_contents', () => supabase.from('shared_contents').select('*').eq('session_id', sessionId).order('created_at', { ascending: false })),
      read('session_events', () => supabase.from('session_events').select('*').eq('session_id', sessionId).eq('event_type', 'buzzer').order('created_at', { ascending: false }).limit(1).maybeSingle()),
      read('questions', () => supabase.from('questions').select('*').eq('session_id', sessionId).order('created_at')),
      read('answers', () => supabase.from('answers').select('*').eq('session_id', sessionId).eq('participant_id', participantId).order('submitted_at'), 30_000),
    ])
    if (requestId !== loadSequence.current || goneSessionId.current === sessionId) return
    // A successful empty session read means it is gone. Cascaded participant
    // reads may fail too, but must not hide this result behind the error guard.
    if (!initial[0].error && !initial[0].data) { markSessionGone(); return }
    if (initial.some((result) => result.error)) return
    const [{ data: sessionData }, { data: participantData }, { data: exitTicketData }, { data: sharedContentData }, { data: buzzerData }, { data: allQuestions }, { data: allAnswers }] = initial
    if (requestId !== loadSequence.current) return
    const nextSession = sessionData as Session | null
    setSession(nextSession)
    setSessionChecked(true)
    if (!handMutation.current && participantRevision.current.accepts(participantReadRevision)) setParticipant(participantData as Participant | null)
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
      const { data: historyScreenshotData } = await read(`screenshots:history:${JSON.stringify(screenshotIds)}`, () => supabase.from('screenshots').select('*').in('id', screenshotIds))
      if (requestId !== loadSequence.current) return
      setHistoryScreenshots(Object.fromEntries(((historyScreenshotData || []) as Screenshot[]).map((item) => [item.id, item])))
    } else {
      setHistoryScreenshots({})
    }

    if (nextSession?.status === 'ended') {
      const { data: summaryData } = await read('ai_summaries:session', () => supabase
        .from('ai_summaries')
        .select('*')
        .eq('session_id', sessionId)
        .eq('type', 'exit_ticket_summary')
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle())
      setSessionSummary(((summaryData as AiSummary | null)?.output_json as SessionAnalysis | undefined) || null)
    } else {
      setSessionSummary(null)
    }

    // What the AI made of each question, kept the way the student's own answers
    // are kept: a newly dispatched question does not take the last one's
    // explanation away, and neither does the end of the class. Read here rather
    // than per question so opening an old one costs nothing.
    //
    // Ordered oldest first on purpose — a re-analysis writes a new row, and the
    // last one written is the one that should win.
    const { data: analysisData } = await read('ai_summaries:questions', () => supabase
      .from('ai_summaries')
      .select('question_id, output_json')
      .eq('session_id', sessionId)
      .eq('type', 'question_analysis')
      .eq('status', 'success')
      .order('created_at', { ascending: true })
      .limit(500))
    setQuestionAnalyses(Object.fromEntries(
      ((analysisData || []) as Array<{ question_id: string | null; output_json: unknown }>)
        .filter((row) => row.question_id)
        .map((row) => [row.question_id as string, row.output_json as QuestionAnalysis]),
    ))

    if (nextSession?.current_question_id) {
      const cachedQuestion = ((allQuestions || []) as Question[]).find(item => item.id === nextSession.current_question_id)
      const questionData = cachedQuestion || (await read(`questions:${nextSession.current_question_id}`, () => supabase.from('questions').select('*').eq('id', nextSession.current_question_id!).single())).data
      // The initial snapshot already includes every answer and every round.
      const answerData = participantAnswers.filter(item => item.question_id === nextSession.current_question_id)
      if (requestId !== loadSequence.current) return
      const nextQuestion = questionData as Question | null
      setQuestion(nextQuestion)
      // Only this round counts as answered. Once the teacher opens another one,
      // the student is unanswered again and the form comes back.
      const rounds = (answerData || []) as Answer[]
      setAnswer(rounds.find((entry) => entry.round === nextQuestion?.answer_round) || null)
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
          // Keep an already loaded form mounted: a transient refresh failure
          // must not discard the student's unfinished answers.
          setQuizLoadRetryable(quizLoadCanRetry(quizError))
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
        const { data } = await read(`screenshots:${nextQuestion.screenshot_id}`, () => supabase.from('screenshots').select('*').eq('id', nextQuestion.screenshot_id!).single())
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

    // The board is loaded separately from the current question because it is
    // not one: the presenter opens it for a topic and carries on dispatching
    // other questions, and the class has to be able to go back to it the whole
    // time. It is on the page alongside whatever they are being asked now.
    if (nextSession?.board_question_id) {
      const cachedBoard = ((allQuestions || []) as Question[]).find(item => item.id === nextSession.board_question_id)
      const boardData = cachedBoard || (await read(`questions:${nextSession.board_question_id}`, () => supabase
        .from('questions').select('*').eq('id', nextSession.board_question_id!).maybeSingle())).data
      if (requestId !== loadSequence.current) return
      const nextBoard = boardData as Question | null
      setBoardQuestion(nextBoard)
      if (nextBoard?.screenshot_id && nextBoard.share_screenshot) {
        const { data } = await read(`screenshots:${nextBoard.screenshot_id}`, () => supabase
          .from('screenshots').select('*').eq('id', nextBoard.screenshot_id!).maybeSingle())
        if (requestId !== loadSequence.current) return
        setBoardImageUrl((data as { public_url: string } | null)?.public_url || null)
      } else {
        setBoardImageUrl(null)
      }
    } else {
      setBoardQuestion(null)
      setBoardImageUrl(null)
    }
  }), [locale, markSessionGone, participantId, participantToken, sessionId])

  const loadHistoryDetails = useCallback(async (historyQuestion: Question) => {
    if (!participantId || !participantToken) return
    // 排序題 and 配對題 need only the answer, which is kept off the question
    // row so the class cannot read it before answering.
    if (historyQuestion.type === 'ordering' || historyQuestion.type === 'matching') {
      if (historyKeys[historyQuestion.id] !== undefined) return
      try {
        const { data } = await requireSupabase().functions.invoke('participant-action', {
          body: { action: 'get_question_key', sessionId, participantId, participantToken, questionId: historyQuestion.id },
        })
        setHistoryKeys((current) => ({ ...current, [historyQuestion.id]: (data?.correctValues || []) as string[] }))
      } catch {
        // Not knowing the answer makes a poorer history entry, not a broken page.
      }
      return
    }
    // What this student handed in, which is a page rather than a row in
    // `answers`: that row only holds a placeholder for these two types.
    if (historyQuestion.type === 'file_upload' || historyQuestion.type === 'drawing') {
      // Refetched while the question is still open, and once more after it
      // closes, because the mark lands whenever the teacher gets to it.
      try {
        const { data, error: resultError } = await requireSupabase().functions.invoke('participant-action', {
          body: { action: 'get_file_result', sessionId, participantId, participantToken, questionId: historyQuestion.id },
        })
        if (resultError || !Array.isArray(data?.responses)) throw new Error('無法讀取作業批改結果，請稍後重試。')
        setHistoryFiles((current) => ({ ...current, [historyQuestion.id]: data.responses as SubmittedFile[] }))
      } catch {
        setError(locale === 'en' ? 'Unable to load your assessment. Please retry.' : '無法讀取你的作業批改結果，請按更新批改結果重試。')
      }
      return
    }
    if (!['custom_quiz', 'pronunciation', 'oral_response'].includes(historyQuestion.type)) return
    // A quiz fetched while it was still running carries no answer key,
    // because while it is running the key is the answer. Once it has
    // stopped, fetch it again so the review can show what was accepted.
    const cachedQuiz = historyQuizData[historyQuestion.id]
    const staleQuiz = historyQuestion.type === 'custom_quiz'
      && cachedQuiz !== undefined && cachedQuiz !== null
      && !cachedQuiz.keys?.length
      && historyQuestion.status !== 'active'
    if (!staleQuiz && (historyQuizData[historyQuestion.id] !== undefined || historyAudioResponses[historyQuestion.id] !== undefined)) return
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
  }, [historyAudioResponses, historyKeys, historyQuizData, participantId, participantToken, sessionId, locale])

  useEffect(() => {
    if (!participantId) navigate(`/join/${sessionId}${location.search}`)
  }, [location.search, navigate, participantId, sessionId])

  // The presenter removed them so they can rejoin under the name on the class
  // list. The row is still there — it holds everything they answered — so the
  // fetch above succeeds and nothing else would notice; without this they sit on
  // a page whose every action is refused, which reads as the app being broken
  // rather than as an instruction to type their name again.
  useEffect(() => {
    if (!participant?.removed_at) return
    localStorage.removeItem(`interact_participant_${sessionId}`)
    localStorage.removeItem(`interact_participant_token_${sessionId}`)
    localStorage.removeItem(`interact_name_${sessionId}`)
    navigate(`/join/${sessionId}${location.search}`, { replace: true })
  }, [location.search, navigate, participant?.removed_at, sessionId])

  useEffect(() => {
    if (!pageVisible) return
    readCache.current.invalidate()
    const timer = window.setTimeout(() => void loadAll(), Math.random() * 600)
    return () => window.clearTimeout(timer)
  }, [loadAll, pageVisible])

  const quizWaiting = quizData?.attempt?.status === 'grading'
    || question?.type === 'custom_quiz' && !quizData && (!quizLoadError || quizLoadRetryable)
  useEffect(() => {
    if (!pageVisible || !liveSessionId || !participantToken || !quizWaiting) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const started = Date.now()
    const delay = () => Math.max(quizLoadError ? 10_000 : 0, classroomRetryDelay(Date.now() - started))
    const poll = async () => {
      try { if (active && navigator.onLine !== false) await loadAll() }
      catch { /* The next bounded retry or Realtime event recovers. */ }
      finally { if (active) timer = setTimeout(poll, delay()) }
    }
    timer = setTimeout(poll, delay())
    return () => { active = false; clearTimeout(timer) }
  }, [loadAll, liveSessionId, pageVisible, participantToken, question?.id, quizWaiting, quizLoadError])

  // Dispatching one question writes a screenshot, a question and the session
  // row, so every student page used to run its seven queries three times over.
  // In a room of 145 that is three thousand queries for one press of 派送, all
  // landing in the same instant — which is what made 派送 itself feel slow.
  //
  // They coalesce into one reload, and the jitter spreads the herd across a
  // second rather than stacking it on one tick.
  const reloadTimer = useRef<number | null>(null)
  const scheduleLoad = useCallback(() => {
    if (reloadTimer.current !== null) return
    reloadTimer.current = window.setTimeout(() => {
      reloadTimer.current = null
      if (document.visibilityState !== 'hidden') void loadAll()
    }, 150 + Math.random() * 600)
  }, [loadAll])

  useEffect(() => {
    const reconnect = () => { readCache.current.invalidate(); scheduleLoad(); void refreshParticipantRow() }
    window.addEventListener('online', reconnect)
    return () => window.removeEventListener('online', reconnect)
  }, [refreshParticipantRow, scheduleLoad])

  useEffect(() => () => {
    if (reloadTimer.current !== null) window.clearTimeout(reloadTimer.current)
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !pageVisible || !sessionId || sessionGone) return
    const supabase = requireSupabase()
    // Keep lifecycle events after class ends. DELETE cannot rely on a row
    // filter unless replica identity is FULL; match its primary key locally.
    const channel = supabase.channel(`participant-session:${sessionId}:${participantId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, () => { readCache.current.invalidate('sessions'); scheduleLoad() })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'sessions' }, payload => {
        if (payload.old?.id === sessionId) markSessionGone()
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') { readCache.current.invalidate(); scheduleLoad() } })
    return () => { void supabase.removeChannel(channel) }
  }, [markSessionGone, pageVisible, participantId, scheduleLoad, sessionGone, sessionId])

  useEffect(() => {
    if (!isSupabaseConfigured || !liveSessionId || !participantId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`participant:${sessionId}:${participantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${sessionId}` }, () => { readCache.current.invalidate('questions'); scheduleLoad() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: `participant_id=eq.${participantId}` }, () => { readCache.current.invalidate('answers'); scheduleLoad() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screenshots', filter: `session_id=eq.${sessionId}` }, () => { readCache.current.invalidate('screenshots'); scheduleLoad() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exit_tickets', filter: `participant_id=eq.${participantId}` }, () => { readCache.current.invalidate('exit_tickets'); scheduleLoad() })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ai_summaries', filter: `session_id=eq.${sessionId}` }, () => { readCache.current.invalidate('ai_summaries'); scheduleLoad() })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'shared_contents', filter: `session_id=eq.${sessionId}` }, () => { readCache.current.invalidate('shared_contents'); scheduleLoad() })
      // Their own row, and no one else's, so that the presenter lowering a
      // hand reaches the student who raised it without costing the class a
      // round of queries. Patched straight from the payload for the same
      // reason the roster does: the changed row already arrived.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'participants', filter: `id=eq.${participantId}` }, (payload) => {
        const row = payload.new as Participant
        if (row?.id !== participantId || row.session_id !== sessionId) return
        readCache.current.invalidate('participants')
        participantRevision.current.changed()
        setParticipant((current) => (current ? { ...current, ...row } : current))
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_events', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const event = payload.new as SessionEvent
        readCache.current.invalidate('session_events')
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
      .subscribe(status => {
        if (status === 'SUBSCRIBED') { readCache.current.invalidate(); void refreshParticipantRow(); scheduleLoad() }
      })

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadAll, liveSessionId, participantId, refreshParticipantRow, scheduleLoad, sessionId])

  // Realtime is the fast path. A small, jittered probe recovers a missed
  // dispatch/switch event without reloading the whole lesson on every tick.
  const latestSession = useRef(session)
  latestSession.current = session
  useEffect(() => {
    if (!isSupabaseConfigured || !pageVisible || !sessionId || !participantId || sessionGone || session?.status === 'ended') return
    let active = true
    let checking = false
    const check = async () => {
      if (!active || checking || document.visibilityState === 'hidden' || navigator.onLine === false) return
      checking = true
      try {
        const { data, error: readError } = await requireSupabase().from('sessions')
          .select('id,current_question_id,status,danmaku_enabled,anonymous_enabled,board_question_id')
          .eq('id', sessionId).maybeSingle()
        if (!active || readError) return
        if (!data) { markSessionGone(); return }
        const current = latestSession.current
        if (!current || Object.entries(data).some(([key, value]) => current[key as keyof Session] !== value)) {
          readCache.current.invalidate()
          scheduleLoad()
        }
      } catch { /* Keep the last known class during a network failure. */ }
      finally { checking = false }
    }
    const timer = window.setInterval(() => void check(), 20_000 + Math.random() * 10_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [markSessionGone, pageVisible, participantId, scheduleLoad, session?.status, sessionGone, sessionId])

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
    // Answer progress and transient teacher Presence never control comments.
    if (!danmakuOpen || messageSending.current) return
    if (!messageFitsLimit(content)) {
      setError(`彈幕上限為 ${MESSAGE_MAX_CJK_CHARACTERS} 個中文字或 ${MESSAGE_MAX_ENGLISH_WORDS} 個英文單字。`)
      return
    }
    setError('')
    messageSending.current = true
    setMessageBusy(true)
    try {
      const { error: sendError } = await requireSupabase().from('messages').insert({
        session_id: sessionId,
        participant_id: participant.id,
        participant_name: participant.name,
        content,
        anonymous_at_display: session?.anonymous_enabled ?? true,
      })
      if (sendError) throw sendError
      setMessage(current => current.trim() === content ? '' : current)
    } catch (err) {
      setError(err instanceof Error ? err.message : '送出失敗')
    } finally {
      messageSending.current = false
      setMessageBusy(false)
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
          round: question.answer_round,
        })
        .select('*')
        .single()
      if (insertError) throw insertError
      readCache.current.invalidate('answers')
      setAnswer(data as Answer)
    } catch (err) {
      setError(err instanceof Error ? err.message : '作答失敗，可能已經提交過。')
    }
  }

  // Ordering and matching go through the function rather than a plain insert:
  // the key lives in a table students cannot read, so only the server can say
  // whether they got it right.
  async function submitOrderedAnswer(values: string[]) {
    if (!participant || !participantToken || !question || !['ordering', 'matching'].includes(question.type)) return
    setOrderedBusy(true)
    setError('')
    try {
      const { data, error: submitError } = await requireSupabase().functions.invoke('participant-action', {
        body: { action: 'submit_ordered_answer', sessionId, participantId: participant.id, participantToken, questionId: question.id, values },
      })
      if (submitError) throw submitError
      if (!data?.answer) throw new Error(data?.message || '作答送出失敗。')
      readCache.current.invalidate('answers')
      setAnswer(data.answer as Answer)
    } catch (caught) {
      setError(await participantFunctionMessage(caught, '作答送出失敗。'))
    } finally {
      setOrderedBusy(false)
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
      readCache.current.invalidate('answers', 'exit_tickets')
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
      readCache.current.invalidate('answers', 'exit_tickets')
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
      readCache.current.invalidate('answers', 'exit_tickets')
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
      readCache.current.invalidate('exit_tickets')
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
        {boardQuestion && participant && participantToken && session && (
          <ParticipantBoard
            imageUrl={boardImageUrl}
            locale={locale}
            // Read-only: the class is over, so nothing more is written.
            locked
            participant={participant}
            participantToken={participantToken}
            question={boardQuestion}
            session={session}
          />
        )}
        {/* Files stay downloadable after class until the presenter deletes the session. */}
        <ParticipantSharedFiles locale={locale} sessionId={sessionId} live={false} />
        <ParticipantQuestionHistory
          analyses={questionAnalyses}
          answers={historyAnswers}
          audioResponses={historyAudioResponses}
          loadingQuestionIds={historyLoadingQuestionIds}
          locale={locale}
          questions={historyQuestions}
          quizData={historyQuizData}
          screenshots={historyScreenshots}
          submittedFiles={historyFiles}
          questionKeys={historyKeys}
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

  // Putting a hand up, and taking it down again. Set locally straight away so
  // the button answers the tap; the row comes back over realtime a moment
  // later, and that is also how the presenter lowering it reaches here.
  async function toggleHand() {
    if (!participant || !participantToken || handBusy) return
    const raised = !participant.hand_raised_at
    const previousHand = participant.hand_raised_at
    participantRevision.current.changed()
    const mutationRevision = participantRevision.current.current()
    handMutation.current = true
    setHandBusy(true)
    setParticipant((current) => (
      current ? { ...current, hand_raised_at: raised ? new Date().toISOString() : null } : current
    ))
    try {
      const { data, error: handError } = await requireSupabase().functions.invoke('participant-action', {
        body: { action: 'set_hand', sessionId, participantId: participant.id, participantToken, raised },
      })
      if (handError) throw handError
      if (data?.participantState?.id === participantId && participantRevision.current.accepts(mutationRevision)) {
        participantRevision.current.changed()
        setParticipant(current => current ? { ...current, ...data.participantState } : current)
      }
    } catch {
      if (participantRevision.current.accepts(mutationRevision)) {
        participantRevision.current.changed()
        setParticipant(current => current ? { ...current, hand_raised_at: previousHand } : current)
      }
    } finally {
      readCache.current.invalidate('participants')
      handMutation.current = false
      setHandBusy(false)
    }
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
        {participant && participantToken && (
          <div className="participant-header-side">
            {standing && (
              <div className="participant-standing">
                <span className="participant-score" title={participantText(locale, 'standingScore')}>
                  {standing.score} {participantText(locale, 'standingPoints')}
                </span>
                <span className="participant-rank">
                  {participantText(locale, 'standingRank')} {standing.rank}/{standing.classSize}
                </span>
                {standing.badges.length > 0 && (
                  <span
                    className="participant-badges"
                    title={standing.badges.map((badge) => `${badge.label}：${badge.detail}`).join('\n')}
                  >
                    {standing.badges.map((badge) => <span key={badge.key}>{badge.icon}</span>)}
                  </span>
                )}
              </div>
            )}
            <button
              aria-pressed={Boolean(participant.hand_raised_at)}
              className={`participant-hand${participant.hand_raised_at ? ' is-raised' : ''}`}
              disabled={handBusy}
              type="button"
              onClick={() => void toggleHand()}
            >
              <Hand size={18} />
              {participantText(locale, participant.hand_raised_at ? 'handLower' : 'handRaise')}
            </button>
          </div>
        )}
      </header>
      {onBreak && (
        <section className="panel participant-break" aria-live="polite">
          <span className="participant-break-icon"><Coffee size={26} /></span>
          <div>
            <h2>{participantText(locale, 'onBreak')}</h2>
            <p>{participantText(locale, 'teacherAway')}</p>
          </div>
        </section>
      )}
      {session && (
        <ParticipantInterpretationAudio
          enabled={session.interpretation_enabled && session.interpretation_audio_enabled}
          languages={session.interpretation_languages}
          sessionId={sessionId}
          locale={locale}
        />
      )}
      <ParticipantSharedFiles locale={locale} sessionId={sessionId} />
      {(question?.type === 'file_upload' || question?.type === 'drawing') && participant && participantToken && (
        <ParticipantFileUpload
          active={question.status === 'active'}
          imageUrl={screenshot?.public_url || null}
          key={question.id}
          locale={locale}
          mode={question.type === 'drawing' ? 'drawing' : 'upload'}
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
      {screenshot && question?.share_screenshot && question?.type !== 'file_upload' && question?.type !== 'drawing' && question?.type !== 'hotspot' && question?.type !== 'board' && (
        <img alt={participantText(locale, 'imageAlt')} className="participant-image" src={screenshot.public_url} />
      )}
      {question?.type === 'camera_poll' ? <CameraPollResult question={question} locale={locale} /> : question?.type === 'custom_quiz' ? (quizData ? (
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
        imageUrl={screenshot?.public_url || null}
        question={question}
        locale={locale}
        onSubmit={submitAnswer}
        onSubmitOrdered={submitOrderedAnswer}
        orderedBusy={orderedBusy}
        onSubmitAudio={submitAudio}
      />}
      {/* Sits between the current question and the danmaku field: the board is
          somewhere the class goes back to, not something they are being asked
          right now, so it stays put while questions come and go above it. */}
      {boardQuestion && participant && participantToken && session && (
        <ParticipantBoard
          imageUrl={boardImageUrl}
          locale={locale}
          locked={onBreak}
          participant={participant}
          participantToken={participantToken}
          question={boardQuestion}
          session={session}
        />
      )}
      <ParticipantQuestionHistory
        activeQuestionId={question?.id}
        answers={historyAnswers}
        audioResponses={historyAudioResponses}
        loadingQuestionIds={historyLoadingQuestionIds}
        locale={locale}
        questions={historyQuestions}
        quizData={historyQuizData}
        screenshots={historyScreenshots}
        submittedFiles={historyFiles}
        questionKeys={historyKeys}
        analyses={questionAnalyses}
        onLoadDetails={loadHistoryDetails}
      />
      {/* Only the stored classroom switch controls comments, not answers or Presence. */}
      <form className={`panel message-form${danmakuOpen ? '' : ' is-closed'}`} onSubmit={sendMessage}>
        <label>
          {participantText(locale, 'sendFeedback')}
          <textarea
            disabled={!danmakuOpen}
            value={message}
            maxLength={MESSAGE_MAX_RAW_CHARACTERS}
            onChange={(event) => {
              setMessage(event.target.value)
              if (error) setError('')
            }}
            placeholder={participantText(locale, danmakuOpen ? 'messagePlaceholder' : 'danmakuClosed')}
          />
        </label>
        <p className={`message-limit${message && !messageFitsLimit(message) ? ' over-limit' : ''}`}>
          {danmakuOpen ? participantText(locale, 'limit') : participantText(locale, 'danmakuClosed')}
          {danmakuOpen && message && ` · ${participantText(locale, 'used')} ${Math.ceil(messageUsage(message).units)}/${MESSAGE_MAX_CJK_CHARACTERS}`}
        </p>
        {error && <p className="error">{error}</p>}
        <button disabled={messageBusy || !danmakuOpen || !message.trim() || !messageFitsLimit(message)} type="submit"><Send size={18} />{participantText(locale, 'send')}</button>
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
