import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { PresenterControlPanel } from '../components/PresenterControlPanel'
import { BuzzerOverlay } from '../components/BuzzerOverlay'
import { QRCodePanel } from '../components/QRCodePanel'
import { ExitTicketResult } from '../components/ExitTicketResult'
import { LotteryOverlay } from '../components/LotteryOverlay'
import { QuestionEditor } from '../components/QuestionEditor'
import { QuestionHistory } from '../components/QuestionHistory'
import { QuestionResult } from '../components/QuestionResult'
import { SetupNotice } from '../components/SetupNotice'
import { TextDispatchModal } from '../components/TextDispatchModal'
import { finalizeLottery } from '../lib/lottery'
import { getPresenterToken } from '../lib/presenterAuth'
import { isBuzzerPending } from '../lib/buzzer'
import { buildJoinUrl } from '../lib/qrcode'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { useSessionPresence } from '../lib/useSessionPresence'
import type { AiSummary, Answer, BuzzerSessionEvent, ExitTicket, LotterySessionEvent, Participant, Question, QuestionAnalysis, QuestionType, Session, SessionEvent } from '../types'
import { useParams } from 'react-router-dom'

export function PresenterPage() {
  const { sessionId = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [answerCounts, setAnswerCounts] = useState<Record<string, number>>({})
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [exitTickets, setExitTickets] = useState<ExitTicket[]>([])
  const [analysis, setAnalysis] = useState<QuestionAnalysis | null>(null)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [controlsOpen, setControlsOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [textDispatchOpen, setTextDispatchOpen] = useState(false)
  const [textDispatchError, setTextDispatchError] = useState('')
  const [lotteryEvent, setLotteryEvent] = useState<LotterySessionEvent | null>(null)
  const [buzzerEvent, setBuzzerEvent] = useState<BuzzerSessionEvent | null>(null)
  const [captureFile, setCaptureFile] = useState<File | null>(null)
  const [capturePreviewUrl, setCapturePreviewUrl] = useState<string | null>(null)
  const [captureSource, setCaptureSource] = useState<InterActCaptureSource | null>(null)
  const [selectionRect, setSelectionRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const activeSelectionPointerId = useRef<number | null>(null)
  const selectionStartRef = useRef<{ x: number; y: number } | null>(null)
  const selectionRectRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)
  const qrPressStartRef = useRef<{ pointerId: number; x: number; y: number; startedAt: number } | null>(null)
  const lastQrPressRef = useRef<{ x: number; y: number; time: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const fallbackJoinUrl = useMemo(() => buildJoinUrl(session?.code || sessionId), [session?.code, sessionId])
  const [joinUrl, setJoinUrl] = useState(fallbackJoinUrl)
  const onlineParticipantIds = useSessionPresence(sessionId)
  const onlineParticipants = useMemo(
    () => participants.filter((participant) => onlineParticipantIds.includes(participant.id)),
    [onlineParticipantIds, participants],
  )

  const loadAll = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId) return

    const supabase = requireSupabase()
    const [{ data: sessionData }, { data: participantData }, { data: questionListData }, { data: answerQuestionData }, { data: exitTicketData }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.from('participants').select('*').eq('session_id', sessionId).order('joined_at'),
      supabase.from('questions').select('*').eq('session_id', sessionId).order('created_at'),
      supabase.from('answers').select('question_id').eq('session_id', sessionId),
      supabase.from('exit_tickets').select('*').eq('session_id', sessionId).order('submitted_at'),
    ])

    const nextSession = sessionData as Session | null
    const nextQuestions = (questionListData || []) as Question[]
    setSession(nextSession)
    setParticipants((participantData || []) as Participant[])
    setQuestions(nextQuestions)
    setExitTickets((exitTicketData || []) as ExitTicket[])
    setAnswerCounts((answerQuestionData || []).reduce<Record<string, number>>((counts, answer) => {
      counts[answer.question_id] = (counts[answer.question_id] || 0) + 1
      return counts
    }, {}))

    const selectedStillExists = selectedQuestionId && nextQuestions.some((item) => item.id === selectedQuestionId)
    const targetQuestionId = selectedStillExists
      ? selectedQuestionId
      : nextSession?.current_question_id || nextQuestions.at(-1)?.id || null

    if (targetQuestionId) {
      const [{ data: questionData }, { data: answerData }, { data: summaryData }] = await Promise.all([
        supabase.from('questions').select('*').eq('id', targetQuestionId).single(),
        supabase.from('answers').select('*').eq('question_id', targetQuestionId).order('submitted_at'),
        supabase
          .from('ai_summaries')
          .select('*')
          .eq('question_id', targetQuestionId)
          .eq('type', 'question_analysis')
          .eq('status', 'success')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
      if (targetQuestionId !== selectedQuestionId) setSelectedQuestionId(targetQuestionId)
      setQuestion(questionData as Question | null)
      setAnswers((answerData || []) as Answer[])
      setAnalysis(((summaryData as AiSummary | null)?.output_json as QuestionAnalysis | undefined) || null)
    } else {
      setQuestion(null)
      setAnswers([])
      setAnalysis(null)
    }
  }, [selectedQuestionId, sessionId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (session?.id && window.interactDesktop) {
      window.interactDesktop.enterPresenterMode(session.id)
    }
  }, [session?.id])

  useEffect(() => {
    if (!session) return
    const fallback = buildJoinUrl(session.code)
    setJoinUrl(session.short_join_url || fallback)
    if (session.short_join_url) return

    const presenterToken = getPresenterToken(session.id)
    if (!presenterToken) return
    let cancelled = false

    requireSupabase().functions.invoke('shorten-url', {
      body: { sessionId: session.id, presenterToken, url: fallback },
    }).then(({ data, error }) => {
      if (!cancelled && !error && typeof data?.shortUrl === 'string') {
        setJoinUrl(data.shortUrl)
      }
    })

    return () => {
      cancelled = true
    }
  }, [session])

  useEffect(() => {
    if (!window.interactDesktop || selectionMode) return
    window.interactDesktop.setPresenterExpanded(controlsOpen || editorOpen || textDispatchOpen)
  }, [controlsOpen, editorOpen, selectionMode, textDispatchOpen])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`presenter:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screenshots', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'exit_tickets', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'session_events', filter: `session_id=eq.${sessionId}` }, (payload) => {
        const event = payload.new as SessionEvent
        if (event.event_type === 'buzzer') {
          setBuzzerEvent(event)
          setLotteryEvent(null)
        } else if (event.event_type === 'lottery') {
          setLotteryEvent(event)
          setBuzzerEvent(null)
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadAll, sessionId])

  useEffect(() => {
    if (!lotteryEvent || lotteryEvent.payload.finalized !== false) return
    const timer = window.setTimeout(() => {
      void finalizeLottery(sessionId, lotteryEvent.id, lotteryEvent.payload.winner_id)
        .then(setLotteryEvent)
        .catch((error) => setAnalysisError(error instanceof Error ? error.message : '抽籤停止失敗。'))
    }, lotteryEvent.payload.duration_ms)
    return () => window.clearTimeout(timer)
  }, [lotteryEvent, sessionId])

  async function updateSession(values: Partial<Session>) {
    if (!session) return
    setBusy(true)
    try {
      await requireSupabase().from('sessions').update(values).eq('id', session.id)
    } finally {
      setBusy(false)
    }
  }

  async function uploadQuestionScreenshot(file: File, type: QuestionType, options: string[], allowMultiple: boolean, promptText: string) {
    setBusy(true)
    try {
      const supabase = requireSupabase()
      const screenshotId = crypto.randomUUID()
      const path = `sessions/${sessionId}/screenshots/${screenshotId}-${file.name}`
      const { error: uploadError } = await supabase.storage.from('interact-screenshots').upload(path, file, { upsert: false })
      if (uploadError) throw uploadError
      const { data: publicData } = supabase.storage.from('interact-screenshots').getPublicUrl(path)
      const { error: insertError } = await supabase
        .from('screenshots')
        .insert({ id: screenshotId, session_id: sessionId, storage_path: path, public_url: publicData.publicUrl, ai_status: 'skipped' })
      if (insertError) throw insertError
      if (session?.current_question_id) {
        await supabase
          .from('questions')
          .update({ status: 'stopped', stopped_at: new Date().toISOString() })
          .eq('id', session.current_question_id)
          .eq('status', 'active')
      }
      const { data: questionData, error: questionError } = await supabase
        .from('questions')
        .insert({
          session_id: sessionId,
          screenshot_id: screenshotId,
          type,
          status: 'active',
          title: questionTitle(type),
          prompt_text: promptText || null,
          options,
          allow_multiple: allowMultiple,
        })
        .select('*')
        .single()
      if (questionError) throw questionError
      const { error: sessionError } = await supabase
        .from('sessions')
        .update({ current_question_id: questionData.id })
        .eq('id', sessionId)
      if (sessionError) throw sessionError
      if (questionData?.id) setSelectedQuestionId(questionData.id)
    } finally {
      setBusy(false)
    }
  }

  function questionTitle(type: QuestionType) {
    const labels: Record<QuestionType, string> = {
      send_screen: '派送畫面',
      poll: '投票題',
      multiple_choice: '選擇題',
      true_false: '是非題',
      short_answer: '問答題',
    }

    return labels[type]
  }

  function dataUrlToFile(dataUrl: string, filename: string) {
    const [meta, base64] = dataUrl.split(',')
    const mime = meta.match(/data:(.*);base64/)?.[1] || 'image/png'
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }

    return new File([bytes], filename, { type: mime })
  }

  async function captureWindowsScreen() {
    if (!window.interactDesktop) return

    setControlsOpen(false)
    setCapturePreviewUrl(null)
    setCaptureFile(null)
    setAnalysisError('')
    setSelectionRect(null)
    selectionStartRef.current = null
    selectionRectRef.current = null
    activeSelectionPointerId.current = null
    setSelectionMode(true)
    try {
      const source = await window.interactDesktop.startCaptureSelection()
      setCaptureSource(source)
    } catch {
      setSelectionMode(false)
      await window.interactDesktop.finishCaptureSelection(false)
    }
  }

  async function cropCapture(rect: { x: number; y: number; width: number; height: number }) {
    if (!captureSource) return

    const image = new Image()
    image.src = captureSource.thumbnailDataUrl
    await image.decode()

    const scaleX = image.naturalWidth / window.innerWidth
    const scaleY = image.naturalHeight / window.innerHeight
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rect.width * scaleX))
    canvas.height = Math.max(1, Math.round(rect.height * scaleY))

    const context = canvas.getContext('2d')
    if (!context) return

    context.drawImage(
      image,
      Math.round(rect.x * scaleX),
      Math.round(rect.y * scaleY),
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    )

    const dataUrl = canvas.toDataURL('image/png')
    const file = dataUrlToFile(dataUrl, `windows-selection-${Date.now()}.png`)
    setCaptureFile(file)
    setCapturePreviewUrl(dataUrl)
    setSelectionMode(false)
    setCaptureSource(null)
    setSelectionRect(null)
    selectionStartRef.current = null
    selectionRectRef.current = null
    activeSelectionPointerId.current = null
    setEditorOpen(true)
    await window.interactDesktop?.finishCaptureSelection(true)
  }

  function selectionRectangle(start: { x: number; y: number }, x: number, y: number) {
    return {
      x: Math.min(start.x, x),
      y: Math.min(start.y, y),
      width: Math.abs(x - start.x),
      height: Math.abs(y - start.y),
    }
  }

  function beginSelection(event: ReactPointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || activeSelectionPointerId.current !== null) return
    if (event.pointerType === 'mouse' && event.button !== 0) return

    event.preventDefault()
    activeSelectionPointerId.current = event.pointerId
    selectionStartRef.current = { x: event.clientX, y: event.clientY }
    const rect = { x: event.clientX, y: event.clientY, width: 0, height: 0 }
    selectionRectRef.current = rect
    setSelectionRect(rect)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function updateSelection(event: ReactPointerEvent<HTMLDivElement>) {
    const start = selectionStartRef.current
    if (activeSelectionPointerId.current !== event.pointerId || !start) return

    event.preventDefault()
    const rect = selectionRectangle(start, event.clientX, event.clientY)
    selectionRectRef.current = rect
    setSelectionRect(rect)
  }

  function cancelSelection() {
    activeSelectionPointerId.current = null
    selectionStartRef.current = null
    selectionRectRef.current = null
    setSelectionMode(false)
    setCaptureSource(null)
    setSelectionRect(null)
    window.interactDesktop?.finishCaptureSelection(false)
  }

  function finishSelection(event: ReactPointerEvent<HTMLDivElement>) {
    const start = selectionStartRef.current
    if (activeSelectionPointerId.current !== event.pointerId || !start) return

    event.preventDefault()
    const rect = selectionRectangle(start, event.clientX, event.clientY)
    activeSelectionPointerId.current = null
    selectionStartRef.current = null
    selectionRectRef.current = rect
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }

    if (rect.width < 16 || rect.height < 16) {
      cancelSelection()
      return
    }

    setSelectionRect(rect)
    cropCapture(rect)
  }

  function beginQrPress(event: ReactPointerEvent<HTMLElement>) {
    if (!event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return
    if ((event.target as HTMLElement).closest('button, a, input, textarea, select')) return
    qrPressStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startedAt: Date.now(),
    }
  }

  function finishQrPress(event: ReactPointerEvent<HTMLElement>) {
    const start = qrPressStartRef.current
    if (!start || start.pointerId !== event.pointerId) return
    qrPressStartRef.current = null

    const now = Date.now()
    const movement = Math.hypot(event.clientX - start.x, event.clientY - start.y)
    if (movement > 18 || now - start.startedAt > 550) {
      lastQrPressRef.current = null
      return
    }

    const previous = lastQrPressRef.current
    if (previous && now - previous.time <= 500 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 48) {
      lastQrPressRef.current = null
      setControlsOpen((current) => !current)
      return
    }

    lastQrPressRef.current = { x: event.clientX, y: event.clientY, time: now }
  }

  async function createScreenshotQuestion(type: QuestionType, options: string[], allowMultiple: boolean, promptText: string) {
    if (!captureFile) return

    setAnalysisError('')
    setEditorOpen(false)
    try {
      await uploadQuestionScreenshot(captureFile, type, options, allowMultiple, promptText)
      setCaptureFile(null)
      setCapturePreviewUrl(null)
    } catch (error) {
      setAnalysisError(`截圖派題失敗：${error instanceof Error ? error.message : '請稍後再試。'}`)
      setEditorOpen(true)
    }
  }

  function cancelQuestionEditor() {
    setEditorOpen(false)
    setCaptureFile(null)
    setCapturePreviewUrl(null)
  }

  async function stopQuestion() {
    if (!session?.current_question_id) return
    await requireSupabase()
      .from('questions')
      .update({ status: 'stopped', stopped_at: new Date().toISOString() })
      .eq('id', session.current_question_id)
  }

  async function setCorrectAnswer(answer: string) {
    if (!question || question.status === 'active') return
    const supabase = requireSupabase()
    const { data: latestQuestion } = await supabase
      .from('questions')
      .select('correct_answers')
      .eq('id', question.id)
      .single()
    const currentCorrectAnswers = latestQuestion?.correct_answers || []
    const correctAnswers = question.allow_multiple
      ? currentCorrectAnswers.includes(answer)
        ? currentCorrectAnswers.filter((option: string) => option !== answer)
        : [...currentCorrectAnswers, answer]
      : [answer]

    await supabase
      .from('questions')
      .update({
        correct_answer: question.allow_multiple ? null : answer,
        correct_answers: correctAnswers,
      })
      .eq('id', question.id)

    const { data: submittedAnswers } = await supabase
      .from('answers')
      .select('id, answer_value, answer_values')
      .eq('question_id', question.id)
    const expected = [...new Set(correctAnswers)].sort()

    await Promise.all(
      (submittedAnswers || []).map((submitted) => {
        const values = submitted.answer_values?.length
          ? submitted.answer_values
          : submitted.answer_value
            ? [submitted.answer_value]
            : []
        const actual = [...new Set(values)].sort()
        const isCorrect = expected.length
          ? actual.length === expected.length && actual.every((value, index) => value === expected[index])
          : null
        return supabase.from('answers').update({ is_correct: isCorrect }).eq('id', submitted.id)
      }),
    )
  }

  async function analyzeQuestion() {
    if (!question) return
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setAnalysisError('這個舊場次沒有講者 AI 權限，請建立新場次後再試。')
      return
    }

    setAnalysisBusy(true)
    setAnalysisError('')
    try {
      const { data, error } = await requireSupabase().functions.invoke('analyze-question', {
        body: { sessionId, questionId: question.id, presenterToken },
      })
      if (error) throw error
      if (!data?.analysis) throw new Error(data?.message || 'AI 沒有回傳分析結果。')
      setAnalysis(data.analysis as QuestionAnalysis)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'AI 分析失敗。')
    } finally {
      setAnalysisBusy(false)
    }
  }

  async function generateExitTicket() {
    if (session?.exit_ticket_prompt) return
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setAnalysisError('這個舊場次沒有講者 AI 權限，請建立新場次後再試。')
      return
    }

    setBusy(true)
    setAnalysisError('')
    try {
      const { data, error } = await requireSupabase().functions.invoke('generate-exit-ticket', {
        body: { sessionId, presenterToken },
      })
      if (error) throw error
      if (!data?.prompt) throw new Error(data?.message || 'AI 沒有產生 Exit Ticket。')
      await loadAll()
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'Exit Ticket 產生失敗。')
    } finally {
      setBusy(false)
    }
  }

  async function openWordCloud() {
    if (window.interactDesktop) {
      await window.interactDesktop.openWordCloud(sessionId)
      return
    }
    const cloudUrl = `${window.location.origin}${window.location.pathname}#/word-cloud/${sessionId}`
    window.open(cloudUrl, `interact-word-cloud-${sessionId}`, 'popup,width=1100,height=720')
  }

  async function drawLottery() {
    await runLottery(onlineParticipants.map((participant) => participant.id), '目前沒有在線學生。')
  }

  async function startBuzzer() {
    if (!onlineParticipants.length) {
      setAnalysisError('目前沒有在線學生。')
      return
    }
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setAnalysisError('這個舊場次沒有講者操作權限，請建立新場次後再試。')
      return
    }

    setBusy(true)
    setAnalysisError('')
    try {
      const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
        body: {
          action: 'start_buzzer',
          sessionId,
          presenterToken,
          candidateIds: onlineParticipants.map((participant) => participant.id),
        },
      })
      if (error) throw error
      if (!data?.event) throw new Error(data?.message || '搶答沒有成功開始。')
      const nextEvent = data.event as BuzzerSessionEvent
      setLotteryEvent(null)
      setBuzzerEvent(nextEvent)
      await window.interactDesktop?.showLottery(nextEvent)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '搶答啟動失敗。')
    } finally {
      setBusy(false)
    }
  }

  async function activateBuzzer(eventId: string) {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) throw new Error('找不到講者操作權限。')

    const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
      body: { action: 'activate_buzzer', sessionId, presenterToken, eventId },
    })
    if (error) throw error
    if (!data?.event) throw new Error(data?.message || '搶答沒有成功開始。')
    const nextEvent = data.event as BuzzerSessionEvent
    setBuzzerEvent(nextEvent)
    await window.interactDesktop?.showLottery(nextEvent)
  }

  async function drawUnanswered(questionId: string) {
    if (!onlineParticipants.length) {
      setAnalysisError('目前沒有在線學生。')
      return
    }

    setBusy(true)
    setAnalysisError('')
    try {
      const { data, error } = await requireSupabase()
        .from('answers')
        .select('participant_id')
        .eq('session_id', sessionId)
        .eq('question_id', questionId)
      if (error) throw error

      const answeredParticipantIds = new Set((data || []).map((answer) => answer.participant_id))
      const unansweredIds = onlineParticipants
        .filter((participant) => !answeredParticipantIds.has(participant.id))
        .map((participant) => participant.id)

      if (!unansweredIds.length) {
        setAnalysisError('目前在線學生皆已作答此題。')
        return
      }
      await invokeLottery(unansweredIds)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '未作答學生抽選失敗。')
    } finally {
      setBusy(false)
    }
  }

  async function runLottery(candidateIds: string[], emptyMessage: string) {
    if (!candidateIds.length) {
      setAnalysisError(emptyMessage)
      return
    }

    setBusy(true)
    setAnalysisError('')
    try {
      await invokeLottery(candidateIds)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '抽籤失敗。')
    } finally {
      setBusy(false)
    }
  }

  async function invokeLottery(candidateIds: string[]) {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      throw new Error('這個舊場次沒有講者操作權限，請建立新場次後再試。')
    }

    const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
      body: { action: 'draw_lottery', sessionId, presenterToken, candidateIds },
    })
    if (error) throw error
    if (!data?.event) throw new Error(data?.message || '抽籤沒有回傳結果。')
    const nextEvent = data.event as LotterySessionEvent
    setLotteryEvent(nextEvent)
    await window.interactDesktop?.showLottery(nextEvent)
  }

  async function selectLotteryCandidate(winnerId: string) {
    if (!lotteryEvent) return
    try {
      setLotteryEvent(await finalizeLottery(sessionId, lotteryEvent.id, winnerId))
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '抽籤停止失敗。')
      throw error
    }
  }

  async function sendSharedContent(body: string, url: string) {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setTextDispatchError('這個舊場次沒有講者操作權限，請建立新場次後再試。')
      return
    }

    setBusy(true)
    setTextDispatchError('')
    try {
      const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
        body: { action: 'share_content', sessionId, presenterToken, body, url },
      })
      if (error) throw error
      if (!data?.content) throw new Error(data?.message || '文字派送失敗。')
      setTextDispatchOpen(false)
    } catch (error) {
      setTextDispatchError(error instanceof Error ? error.message : '文字派送失敗。')
    } finally {
      setBusy(false)
    }
  }

  async function endClass() {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setAnalysisError('這個舊場次沒有講者 AI 權限，請建立新場次後再試。')
      return
    }

    setBusy(true)
    try {
      if (window.interactDesktop) {
        await window.interactDesktop.openSessionReport(sessionId)
      } else {
        window.location.hash = `/session-report/${sessionId}`
      }
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '無法開啟課堂報告。')
      setBusy(false)
    }
  }

  function selectQuestion(questionId: string) {
    setAnalysisError('')
    setSelectedQuestionId(questionId)
  }

  if (!session) {
    return (
      <main className="center-page">
        <SetupNotice />
        <p className="muted">載入講者頁...</p>
      </main>
    )
  }

  return (
    <main className={`presenter-page${controlsOpen ? ' controls-open' : ''}${selectionMode ? ' selecting-capture' : ''}`}>
      {!selectionMode && (
        <aside className="qr-floating">
          <QRCodePanel
            joinUrl={joinUrl}
            onClose={window.interactDesktop ? () => window.interactDesktop?.close() : undefined}
            onMinimize={window.interactDesktop ? () => window.interactDesktop?.minimize() : undefined}
            qrInteractionProps={{
              onPointerCancel: (event) => {
                if (qrPressStartRef.current?.pointerId === event.pointerId) qrPressStartRef.current = null
              },
              onPointerDown: beginQrPress,
              onPointerUp: finishQrPress,
            }}
          />
        </aside>
      )}
      {controlsOpen && (
        <aside className="presenter-controls-overlay" onDoubleClick={(event) => event.stopPropagation()}>
        <PresenterControlPanel
          busy={busy}
          buzzerActive={isBuzzerPending(buzzerEvent)}
          onlineCount={onlineParticipants.length}
          session={session}
          onDrawLottery={drawLottery}
          onStartBuzzer={startBuzzer}
          onStopQuestion={stopQuestion}
          onToggleAnonymous={() => updateSession({ anonymous_enabled: !session.anonymous_enabled })}
          onToggleDanmaku={() => updateSession({ danmaku_enabled: !session.danmaku_enabled })}
          onCaptureScreen={window.interactDesktop ? captureWindowsScreen : undefined}
          onGenerateExitTicket={generateExitTicket}
          onEndClass={endClass}
          onOpenTextDispatch={() => {
            setTextDispatchError('')
            setTextDispatchOpen(true)
          }}
          onOpenWordCloud={openWordCloud}
        />
        <QuestionHistory
          activeQuestionId={session.current_question_id}
          answerCounts={answerCounts}
          questions={questions}
          selectedQuestionId={selectedQuestionId}
          onSelect={selectQuestion}
        />
        <QuestionResult
          analysis={analysis}
          analysisBusy={analysisBusy}
          analysisError={analysisError}
          answers={answers}
          busy={busy}
          isCurrentQuestion={question?.id === session.current_question_id}
          onlineCount={onlineParticipants.length}
          question={question}
          onAnalyze={analyzeQuestion}
          onDrawUnanswered={drawUnanswered}
          onSetCorrectAnswer={setCorrectAnswer}
        />
        {session.exit_ticket_prompt && session.exit_ticket_category && (
          <ExitTicketResult
            category={session.exit_ticket_category}
            onlineCount={onlineParticipants.length}
            prompt={session.exit_ticket_prompt}
            tickets={exitTickets}
          />
        )}
      </aside>
      )}
      {selectionMode && (
        <div
          className="capture-selection-layer"
          onLostPointerCapture={(event) => {
            if (activeSelectionPointerId.current === event.pointerId) cancelSelection()
          }}
          onPointerCancel={(event) => {
            if (activeSelectionPointerId.current === event.pointerId) cancelSelection()
          }}
          onPointerDown={beginSelection}
          onPointerMove={updateSelection}
          onPointerUp={finishSelection}
        >
          <p className="capture-selection-hint">拖曳框選要派送的畫面區域</p>
          {selectionRect && (
            <div
              className="capture-selection-box"
              style={{
                left: selectionRect.x,
                top: selectionRect.y,
                width: selectionRect.width,
                height: selectionRect.height,
              }}
            />
          )}
        </div>
      )}
      <QuestionEditor
        error={analysisError}
        open={editorOpen}
        previewUrl={capturePreviewUrl}
        onCancel={cancelQuestionEditor}
        onCreate={createScreenshotQuestion}
      />
      <TextDispatchModal
        busy={busy}
        error={textDispatchError}
        open={textDispatchOpen}
        onCancel={() => setTextDispatchOpen(false)}
        onSend={sendSharedContent}
      />
      {!window.interactDesktop && <LotteryOverlay event={lotteryEvent} onSelect={selectLotteryCandidate} />}
      {!window.interactDesktop && (
        <BuzzerOverlay
          event={buzzerEvent}
          onStart={buzzerEvent ? () => activateBuzzer(buzzerEvent.id) : undefined}
        />
      )}
    </main>
  )
}
