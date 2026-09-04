import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { PresenterControlPanel } from '../components/PresenterControlPanel'
import { PresenterSettingsModal } from '../components/PresenterSettingsModal'
import type { PresenterCaptionSettings } from '../components/PresenterSettingsModal'
import { LiveCaptionOverlay } from '../components/LiveCaptionOverlay'
import { BuzzerOverlay } from '../components/BuzzerOverlay'
import { QRCodePanel } from '../components/QRCodePanel'
import { ExitTicketResult } from '../components/ExitTicketResult'
import { LotteryOverlay } from '../components/LotteryOverlay'
import { QuestionEditor } from '../components/QuestionEditor'
import type { CustomQuizSettings } from '../lib/customQuiz'
import { QuestionHistory } from '../components/QuestionHistory'
import { QuestionResult } from '../components/QuestionResult'
import { CustomQuizResult } from '../components/CustomQuizResult'
import { SetupNotice } from '../components/SetupNotice'
import { TextDispatchModal } from '../components/TextDispatchModal'
import { FileTransferModal } from '../components/FileTransferModal'
import { finalizeLottery } from '../lib/lottery'
import { getPresenterToken } from '../lib/presenterAuth'
import { endManagedSession } from '../lib/presenterSessions'
import { isBuzzerPending } from '../lib/buzzer'
import { buildJoinUrl } from '../lib/qrcode'
import { createRealtimeCaptionConnection } from '../lib/liveCaptions'
import { createGeminiCaptionConnection } from '../lib/geminiCaptions'
import { createInterpretationAudioBroadcaster } from '../lib/liveInterpretation'
import { logDiagnostic } from '../lib/diagnostics'
import { createCaptionTextNormalizer } from '../lib/traditionalChinese'
import { SOURCE_CAPTION_LANGUAGE, resolvedCaptionLanguage } from '../lib/captionLanguages'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import { useSessionPresence } from '../lib/useSessionPresence'
import type { AiSummary, Answer, AudioResponse, BuzzerSessionEvent, ExitTicket, FileResponse, SharedFile, LotterySessionEvent, Participant, PresenterQuizResults, Question, QuestionAnalysis, QuestionType, Session, SessionEvent } from '../types'
import { useParams } from 'react-router-dom'
import type { RealtimeChannel } from '@supabase/supabase-js'

function microphoneErrorMessage(error: unknown) {
  if (!(error instanceof DOMException)) return error instanceof Error ? error.message : '無法讀取麥克風。'
  if (error.name === 'NotAllowedError') return 'Windows 或程式未允許使用麥克風。'
  if (error.name === 'NotFoundError') return '找不到可用的麥克風。'
  if (error.name === 'NotReadableError') return '麥克風正被其他程式獨占，暫時無法使用。'
  if (error.name === 'OverconstrainedError') return '先前選擇的麥克風目前不可用。'
  return error.message || '無法讀取麥克風。'
}

function realtimeRetryDelay(message: string) {
  const match = message.match(/try again in\s+([\d.]+)\s*(ms|s)/i)
  if (!match) return null
  const value = Number(match[1])
  if (!Number.isFinite(value)) return null
  return Math.min(65_000, Math.max(500, match[2].toLowerCase() === 's' ? value * 1000 : value) + 350)
}

function readableRealtimeError(message: string) {
  if (/tokens per min|TPM/i.test(message)) return 'OpenAI 即時翻譯用量上限不足，請提高 API Project 的使用等級或限制。'
  if (/rate limit reached/i.test(message)) return 'OpenAI 即時翻譯連線頻率暫時達到上限，請稍候再試。'
  return message
}

async function edgeFunctionErrorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context
  if (context) {
    try {
      const payload = await context.clone().json() as { message?: unknown }
      if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
    } catch {
      // Fall back to the SDK error message when the response is not JSON.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback
}

export function PresenterPage() {
  const { sessionId = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [questions, setQuestions] = useState<Question[]>([])
  const [answerCounts, setAnswerCounts] = useState<Record<string, number>>({})
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null)
  const [question, setQuestion] = useState<Question | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [audioResponses, setAudioResponses] = useState<AudioResponse[]>([])
  const [exitTickets, setExitTickets] = useState<ExitTicket[]>([])
  const [analysis, setAnalysis] = useState<QuestionAnalysis | null>(null)
  const [quizResults, setQuizResults] = useState<PresenterQuizResults | null>(null)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [analysisError, setAnalysisError] = useState('')
  const [endClassConfirmOpen, setEndClassConfirmOpen] = useState(false)
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [closingSession, setClosingSession] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [textDispatchOpen, setTextDispatchOpen] = useState(false)
  const [textDispatchError, setTextDispatchError] = useState('')
  const [fileTransferOpen, setFileTransferOpen] = useState(false)
  const [sharedFiles, setSharedFiles] = useState<SharedFile[]>([])
  const [fileResponses, setFileResponses] = useState<FileResponse[]>([])
  const [collectQuestion, setCollectQuestion] = useState<Question | null>(null)
  const [fileBusyId, setFileBusyId] = useState('')
  // Read by the polling timer, which must not overwrite a row mid-marking.
  const markingRef = useRef(false)
  const [gradeProgress, setGradeProgress] = useState<{ done: number; total: number } | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [settingsError, setSettingsError] = useState('')
  const [captionError, setCaptionError] = useState('')
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([])
  const [selectedMicrophoneId, setSelectedMicrophoneId] = useState(() => localStorage.getItem('interact:caption-microphone') || '')
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
  const [busy, setBusy] = useState(false)
  const [liveCaptions, setLiveCaptions] = useState<Record<string, string>>({})
  const captionConnectionsRef = useRef<Array<{ close: () => void }>>([])
  const interpretationBroadcastersRef = useRef<Array<{ close: () => void }>>([])
  const captionWriteQueueRef = useRef<Promise<void>>(Promise.resolve())
  const captionRetryTimersRef = useRef<number[]>([])
  const captionDisplayTimersRef = useRef<Map<string, number>>(new Map())
  const captionHideTimersRef = useRef<Map<string, number>>(new Map())
  const pendingDisplayCaptionsRef = useRef<Map<string, string>>(new Map())
  const captionRunIdRef = useRef(0)
  const captionStreamRef = useRef<MediaStream | null>(null)
  const captionChannelRef = useRef<RealtimeChannel | null>(null)
  const interpretationAudioContextRef = useRef<AudioContext | null>(null)
  const recordingStateRecoveredRef = useRef(false)

  function prepareInterpretationAudioContext() {
    const current = interpretationAudioContextRef.current
    const audioContext = current && current.state !== 'closed'
      ? current
      : new AudioContext({ sampleRate: 24_000 })
    interpretationAudioContextRef.current = audioContext
    if (audioContext.state !== 'running') void audioContext.resume()
    return audioContext
  }
  const fallbackJoinUrl = useMemo(
    () => buildJoinUrl(session?.code || sessionId),
    [session?.code, sessionId],
  )
  const [joinUrl, setJoinUrl] = useState(fallbackJoinUrl)
  const onlineParticipantIds = useSessionPresence(sessionId)
  const onlineParticipants = useMemo(
    () => participants.filter((participant) => onlineParticipantIds.includes(participant.id)),
    [onlineParticipantIds, participants],
  )

  const clearCaptionDisplayTimers = useCallback(() => {
    for (const timer of captionDisplayTimersRef.current.values()) window.clearTimeout(timer)
    for (const timer of captionHideTimersRef.current.values()) window.clearTimeout(timer)
    captionDisplayTimersRef.current.clear()
    captionHideTimersRef.current.clear()
    pendingDisplayCaptionsRef.current.clear()
  }, [])

  const publishLiveCaption = useCallback((language: string, text: string, final: boolean) => {
    pendingDisplayCaptionsRef.current.set(language, text)
    const flush = (isFinal: boolean) => {
      const latest = pendingDisplayCaptionsRef.current.get(language) || ''
      pendingDisplayCaptionsRef.current.delete(language)
      setLiveCaptions((current) => ({ ...current, [language]: latest }))
      void captionChannelRef.current?.send({
        type: 'broadcast',
        event: 'caption',
        payload: { language, text: latest, final: isFinal, createdAt: new Date().toISOString() },
      })

      window.clearTimeout(captionHideTimersRef.current.get(language))
      captionHideTimersRef.current.set(language, window.setTimeout(() => {
        setLiveCaptions((current) => current[language] === latest ? { ...current, [language]: '' } : current)
        captionHideTimersRef.current.delete(language)
      }, 2000))
    }

    if (final) {
      window.clearTimeout(captionDisplayTimersRef.current.get(language))
      captionDisplayTimersRef.current.delete(language)
      flush(true)
      return
    }
    if (captionDisplayTimersRef.current.has(language)) return
    captionDisplayTimersRef.current.set(language, window.setTimeout(() => {
      captionDisplayTimersRef.current.delete(language)
      flush(false)
    }, 180))
  }, [])

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
      const loadedQuestion = questionData as Question | null
      if (loadedQuestion?.type === 'custom_quiz') {
        const presenterToken = getPresenterToken(sessionId)
        if (presenterToken) {
          const { data: quizData } = await supabase.functions.invoke('presenter-action', {
            body: { action: 'get_custom_quiz_results', sessionId, presenterToken, questionId: targetQuestionId },
          })
          setQuizResults((quizData as PresenterQuizResults | null) || null)
        }
        setAudioResponses([])
      } else if (loadedQuestion && ['pronunciation', 'oral_response'].includes(loadedQuestion.type) && loadedQuestion.status !== 'active') {
        setQuizResults(null)
        const presenterToken = getPresenterToken(sessionId)
        if (presenterToken) {
          const { data: recordingData } = await supabase.functions.invoke('presenter-action', {
            body: { action: 'get_recording_results', sessionId, presenterToken, questionId: targetQuestionId },
          })
          setAudioResponses((recordingData?.responses || []) as AudioResponse[])
        }
      } else {
        setQuizResults(null)
        setAudioResponses([])
      }
    } else {
      setQuestion(null)
      setAnswers([])
      setAudioResponses([])
      setQuizResults(null)
      setAnalysis(null)
    }
  }, [selectedQuestionId, sessionId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!session || recordingStateRecoveredRef.current) return
    recordingStateRecoveredRef.current = true
    if (!session.recording_enabled || captionConnectionsRef.current.length) return
    const presenterToken = getPresenterToken(session.id)
    if (!presenterToken) return
    void requireSupabase().functions.invoke('presenter-action', {
      body: {
        action: 'update_session',
        sessionId: session.id,
        presenterToken,
        recordingEnabled: false,
        captionsEnabled: false,
        captionStatus: 'idle',
      },
    }).then(({ error }) => {
      if (error) throw error
      return loadAll()
    }).catch((error: unknown) => {
      setCaptionError(error instanceof Error ? error.message : '無法清除上次中斷的課程錄製狀態。')
    })
  }, [loadAll, session])

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
    window.interactDesktop.setPresenterExpanded(
      controlsOpen || editorOpen || textDispatchOpen || settingsOpen || endClassConfirmOpen || closeConfirmOpen || fileTransferOpen,
      settingsOpen,
      editorOpen || fileTransferOpen,
    )
  }, [closeConfirmOpen, controlsOpen, editorOpen, endClassConfirmOpen, fileTransferOpen, selectionMode, settingsOpen, textDispatchOpen])

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
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase.channel(`captions:${sessionId}`).subscribe()
    captionChannelRef.current = channel
    return () => {
      captionChannelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [sessionId])

  const refreshMicrophones = useCallback(async () => {
    setSettingsError('')
    try {
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      permissionStream.getTracks().forEach((track) => track.stop())
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'audioinput')
      setMicrophones(devices)
      if (selectedMicrophoneId && !devices.some((device) => device.deviceId === selectedMicrophoneId)) {
        setSelectedMicrophoneId('')
        localStorage.removeItem('interact:caption-microphone')
      }
    } catch (error) {
      setSettingsError(microphoneErrorMessage(error))
    }
  }, [selectedMicrophoneId])

  useEffect(() => {
    if (!settingsOpen) return
    const handleDeviceChange = () => void refreshMicrophones()
    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange)
    return () => navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange)
  }, [refreshMicrophones, settingsOpen])

  function openPresenterSettings() {
    setSettingsError('')
    setSettingsOpen(true)
    void refreshMicrophones()
  }

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
    const presenterToken = getPresenterToken(session.id)
    if (!presenterToken) {
      setAnalysisError('找不到講者權限，請重新加入場次。')
      return
    }
    setBusy(true)
    try {
      const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
        body: {
          action: 'update_session',
          sessionId: session.id,
          presenterToken,
          danmakuEnabled: values.danmaku_enabled,
          anonymousEnabled: values.anonymous_enabled,
          recordingEnabled: values.recording_enabled,
          captionsEnabled: values.captions_enabled,
          captionStatus: values.caption_status,
        },
      })
      if (error) throw error
      if (!data?.session) throw new Error(data?.message || '場次設定更新失敗。')
      setSession(data.session as Session)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '場次設定更新失敗。')
    } finally {
      setBusy(false)
    }
  }

  const stopCourseRecording = useCallback(async (persistState = true, waitForWrites = true) => {
    captionRunIdRef.current += 1
    for (const timer of captionRetryTimersRef.current) window.clearTimeout(timer)
    captionRetryTimersRef.current = []
    for (const broadcaster of interpretationBroadcastersRef.current) broadcaster.close()
    interpretationBroadcastersRef.current = []
    for (const connection of captionConnectionsRef.current) connection.close()
    captionConnectionsRef.current = []
    for (const track of captionStreamRef.current?.getTracks() || []) track.stop()
    captionStreamRef.current = null
    const pendingWrites = captionWriteQueueRef.current
    captionWriteQueueRef.current = Promise.resolve()
    if (waitForWrites) await pendingWrites.catch(() => {})
    clearCaptionDisplayTimers()
    setLiveCaptions({})
    setCaptionError('')
    await captionChannelRef.current?.send({ type: 'broadcast', event: 'caption', payload: { cleared: true } })

    if (persistState) {
      const presenterToken = getPresenterToken(sessionId)
      if (presenterToken) {
        await requireSupabase().functions.invoke('presenter-action', {
          body: { action: 'update_session', sessionId, presenterToken, recordingEnabled: false, captionsEnabled: false, captionStatus: 'idle' },
        })
        await loadAll()
      }
    }
  }, [clearCaptionDisplayTimers, loadAll, sessionId])

  async function startCourseRecording(targetSession: Session | null = session, microphoneId = selectedMicrophoneId) {
    if (!targetSession || captionConnectionsRef.current.length) return
    const presenterToken = getPresenterToken(targetSession.id)
    if (!presenterToken) {
      setAnalysisError('找不到講者權限，請重新加入場次。')
      return
    }
    const interpretationAudioContext = targetSession.interpretation_audio_enabled
      ? prepareInterpretationAudioContext()
      : null

    setBusy(true)
    setAnalysisError('')
    setCaptionError('')
    setLiveCaptions({})
    const runId = ++captionRunIdRef.current
    let reconnectScheduled = false
    try {
      await captionChannelRef.current?.send({ type: 'broadcast', event: 'caption', payload: { cleared: true } })
      const { error: startingError } = await requireSupabase().functions.invoke('presenter-action', {
        body: { action: 'update_session', sessionId, presenterToken, recordingEnabled: true, captionStatus: 'starting' },
      })
      if (startingError) throw startingError
      const audioConstraints: MediaTrackConstraints = {
        ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
      let stream: MediaStream
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      } catch (error) {
        if (!microphoneId || !(error instanceof DOMException) || !['NotFoundError', 'OverconstrainedError'].includes(error.name)) throw error
        setSelectedMicrophoneId('')
        localStorage.removeItem('interact:caption-microphone')
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
      }
      captionStreamRef.current = stream
      // Choosing 原始語言 is choosing not to be rewritten: the conversion also
      // swaps mainland vocabulary for Taiwanese (視頻 for 影片, 軟件 for 軟體),
      // which is wrong when the words themselves are what the lesson is about.
      const normalizeCaptionText = await createCaptionTextNormalizer(
        targetSession.caption_display_language !== SOURCE_CAPTION_LANGUAGE
        && (targetSession.caption_source_language === 'zh-tw'
          || targetSession.caption_display_language === 'zh-tw'
          || targetSession.interpretation_languages.includes('zh-tw')),
      )

      const persistCaption = async (language: string, text: string) => {
        const segmentId = crypto.randomUUID()
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const { error } = await requireSupabase().functions.invoke('presenter-action', {
              body: {
                action: 'append_caption',
                sessionId,
                presenterToken,
                segmentId,
                language,
                sourceLanguage: targetSession.caption_source_language,
                text,
              },
              timeout: 12_000,
            })
            if (error) throw error
            return
          } catch (error) {
            if (attempt === 0) {
              await new Promise((resolve) => window.setTimeout(resolve, 500))
              continue
            }
            console.error('Unable to persist caption segment', error)
            logDiagnostic('caption_persist_failed', {
              sessionId,
              language,
              message: await edgeFunctionErrorMessage(error, '字幕儲存失敗。'),
            })
            setCaptionError('字幕仍會顯示，但有一段逐字稿儲存失敗；請檢查網路後再結束課程。')
          }
        }
      }
      const onCaption = ({ language, text, final }: { language: string; text: string; final: boolean }) => {
        const normalizedText = normalizeCaptionText(language, text)
        publishLiveCaption(language, normalizedText, final)
        if (final) {
          captionWriteQueueRef.current = captionWriteQueueRef.current
            .catch(() => {})
            .then(() => persistCaption(language, normalizedText))
        }
      }
      const onError = (message: string) => {
        logDiagnostic('caption_service_error', { sessionId, message })
        setCaptionError(message)
        void requireSupabase().functions.invoke('presenter-action', {
          body: { action: 'update_session', sessionId, presenterToken, captionStatus: 'error' },
          timeout: 12_000,
        })
      }
      const onDisconnected = (message: string) => {
        if (reconnectScheduled || captionRunIdRef.current !== runId) return
        reconnectScheduled = true
        logDiagnostic('caption_transport_disconnected', { sessionId, message })
        setCaptionError('即時字幕連線中斷，正在自動重新連線…')
        const timer = window.setTimeout(() => {
          captionRetryTimersRef.current = captionRetryTimersRef.current.filter((item) => item !== timer)
          if (captionRunIdRef.current !== runId) return
          void (async () => {
            await stopCourseRecording(false, false)
            await startCourseRecording(targetSession, microphoneId)
          })().catch((error: unknown) => {
            const reconnectMessage = error instanceof Error ? error.message : '即時字幕自動重連失敗。'
            logDiagnostic('caption_reconnect_failed', { sessionId, message: reconnectMessage })
            setCaptionError(reconnectMessage)
          })
        }, 2_500)
        captionRetryTimersRef.current.push(timer)
      }

      const useGemini = !targetSession.interpretation_audio_enabled
      const openCaptionConnection = useGemini ? createGeminiCaptionConnection : createRealtimeCaptionConnection

      const targets = [...new Set([
        // "原始語言" means the transcript itself, so there is nothing to translate.
        ...(targetSession.caption_display_language !== SOURCE_CAPTION_LANGUAGE
          && targetSession.caption_display_language !== targetSession.caption_source_language
          ? [targetSession.caption_display_language]
          : []),
        ...(targetSession.interpretation_enabled ? targetSession.interpretation_languages : []),
      ])].filter((language) => language !== targetSession.caption_source_language)
      const transcriptionConnection = await openCaptionConnection({
          sessionId,
          presenterToken,
          mode: 'transcription',
          language: targetSession.caption_source_language,
          sourceLanguage: targetSession.caption_source_language,
          raw: targetSession.caption_display_language === SOURCE_CAPTION_LANGUAGE,
          stream,
          onCaption,
          onError,
          onDisconnected,
        })
      captionConnectionsRef.current = [transcriptionConnection]
      const connectTranslation = async (language: string, retryCount = 0): Promise<void> => {
        if (captionRunIdRef.current !== runId) return
        let translationConnection: { close: () => void } | null = null
        let retryScheduled = false
        try {
          translationConnection = await openCaptionConnection({
            sessionId,
            presenterToken,
            mode: 'translation',
            language,
            sourceLanguage: targetSession.caption_source_language,
            stream,
            onTranslatedAudio: targetSession.interpretation_audio_enabled && targetSession.interpretation_languages.includes(language)
              ? (translatedStream) => {
                  const audioContext = interpretationAudioContext || prepareInterpretationAudioContext()
                  void createInterpretationAudioBroadcaster(sessionId, language, translatedStream, audioContext, (message) => {
                    setCaptionError(`${language.toUpperCase()} 即時口譯語音：${message}`)
                  })
                    .then((broadcaster) => interpretationBroadcastersRef.current.push(broadcaster))
                    .catch((error: unknown) => setCaptionError(error instanceof Error ? error.message : '即時口譯語音啟動失敗。'))
                }
              : undefined,
            onCaption,
            onDisconnected,
            onError: (message) => {
              const retryDelay = realtimeRetryDelay(message)
              if (!retryScheduled && retryDelay !== null && retryCount < 2 && captionRunIdRef.current === runId) {
                retryScheduled = true
                setCaptionError(`${language.toUpperCase()} 即時口譯連線忙碌，正在自動重連…`)
                const timer = window.setTimeout(() => {
                  captionRetryTimersRef.current = captionRetryTimersRef.current.filter((item) => item !== timer)
                  translationConnection?.close()
                  if (translationConnection) {
                    captionConnectionsRef.current = captionConnectionsRef.current.filter((item) => item !== translationConnection)
                  }
                  void connectTranslation(language, retryCount + 1)
                }, retryDelay)
                captionRetryTimersRef.current.push(timer)
                return
              }
              setCaptionError(`${language.toUpperCase()} 即時口譯：${readableRealtimeError(message)}`)
            },
          })
          if (captionRunIdRef.current !== runId) {
            translationConnection.close()
            return
          }
          captionConnectionsRef.current.push(translationConnection)
        } catch (error) {
          const message = error instanceof Error ? error.message : '即時口譯連線失敗。'
          const retryDelay = realtimeRetryDelay(message)
          if (retryDelay !== null && retryCount < 2 && captionRunIdRef.current === runId) {
            setCaptionError(`${language.toUpperCase()} 即時口譯連線忙碌，正在自動重連…`)
            const timer = window.setTimeout(() => {
              captionRetryTimersRef.current = captionRetryTimersRef.current.filter((item) => item !== timer)
              void connectTranslation(language, retryCount + 1)
            }, retryDelay)
            captionRetryTimersRef.current.push(timer)
            return
          }
          setCaptionError(`${language.toUpperCase()} 即時口譯：${readableRealtimeError(message)}`)
        }
      }
      for (const language of targets) await connectTranslation(language)
      const { error: liveError } = await requireSupabase().functions.invoke('presenter-action', {
        body: { action: 'update_session', sessionId, presenterToken, captionStatus: 'live' },
      })
      if (liveError) throw liveError
      await loadAll()
    } catch (error) {
      await stopCourseRecording(false)
      await requireSupabase().functions.invoke('presenter-action', {
        body: { action: 'update_session', sessionId, presenterToken, recordingEnabled: false, captionsEnabled: false, captionStatus: 'error' },
      })
      const message = microphoneErrorMessage(error)
      setCaptionError(message || '課程錄製啟動失敗。')
      await loadAll()
    } finally {
      setBusy(false)
    }
  }

  async function toggleCourseRecording() {
    if (captionConnectionsRef.current.length) await stopCourseRecording()
    else await startCourseRecording()
  }

  async function toggleCaptionVisibility() {
    if (!session?.recording_enabled) return
    await updateSession({ captions_enabled: !session.captions_enabled })
  }

  async function savePresenterSettings(settings: PresenterCaptionSettings, microphoneId: string) {
    if (!session) return
    const presenterToken = getPresenterToken(session.id)
    if (!presenterToken) {
      setSettingsError('找不到講師權限，請重新加入場次。')
      return
    }
    if (settings.interpretationAudioEnabled) prepareInterpretationAudioContext()

    setSettingsBusy(true)
    setSettingsError('')
    const captionsWereActive = captionConnectionsRef.current.length > 0
    const captionsWereVisible = session.captions_enabled
    try {
      if (captionsWereActive) await stopCourseRecording()
      const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
        body: {
          action: 'update_session',
          sessionId,
          presenterToken,
          captionSourceLanguage: settings.sourceLanguage,
          captionDisplayLanguage: settings.displayLanguage,
          captionFontSize: settings.fontSize,
          captionFontBold: settings.fontBold,
          captionPosition: settings.position,
          interpretationAudioEnabled: settings.interpretationAudioEnabled,
          interpretationLanguages: settings.interpretationLanguages,
        },
      })
      if (error) throw error
      if (!data?.session) throw new Error(data?.message || '字幕設定儲存失敗。')
      const nextSession = data.session as Session
      setSession(nextSession)
      setSelectedMicrophoneId(microphoneId)
      if (microphoneId) localStorage.setItem('interact:caption-microphone', microphoneId)
      else localStorage.removeItem('interact:caption-microphone')
      setSettingsOpen(false)
      if (captionsWereActive) {
        await startCourseRecording(nextSession, microphoneId)
        if (captionsWereVisible) {
          await requireSupabase().functions.invoke('presenter-action', {
            body: { action: 'update_session', sessionId, presenterToken, captionsEnabled: true },
          })
          await loadAll()
        }
      } else await loadAll()
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : '字幕設定儲存失敗。')
    } finally {
      setSettingsBusy(false)
    }
  }

  useEffect(() => () => {
    clearCaptionDisplayTimers()
    for (const broadcaster of interpretationBroadcastersRef.current) broadcaster.close()
    for (const connection of captionConnectionsRef.current) connection.close()
    for (const track of captionStreamRef.current?.getTracks() || []) track.stop()
    void interpretationAudioContextRef.current?.close()
  }, [clearCaptionDisplayTimers])

  async function uploadQuestionScreenshot(file: File, type: QuestionType, options: string[], allowMultiple: boolean, promptText: string, quizSettings?: CustomQuizSettings) {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) throw new Error('找不到講者權限，請重新加入場次。')
    setBusy(true)
    try {
      const supabase = requireSupabase()
      const { data: prepared, error: prepareError } = await supabase.functions.invoke('presenter-action', {
        body: {
          action: 'prepare_screenshot_upload',
          sessionId,
          presenterToken,
          fileName: file.name,
        },
      })
      if (prepareError) throw new Error(await edgeFunctionErrorMessage(prepareError, '無法準備截圖上傳。'))
      if (!prepared?.screenshotId || !prepared?.storagePath || !prepared?.uploadToken) {
        throw new Error(prepared?.message || '無法準備截圖上傳。')
      }

      const { error: uploadError } = await supabase.storage
        .from('interact-screenshots')
        .uploadToSignedUrl(prepared.storagePath, prepared.uploadToken, file, {
          contentType: file.type || 'image/png',
          upsert: false,
        })
      if (uploadError) throw uploadError

      const { data, error } = await supabase.functions.invoke('presenter-action', {
        body: type === 'custom_quiz' ? {
          action: 'create_custom_quiz',
          sessionId,
          presenterToken,
          screenshotId: prepared.screenshotId,
          storagePath: prepared.storagePath,
          direction: quizSettings?.direction || promptText,
          requestedCount: quizSettings?.requestedCount ?? null,
          requestedType: quizSettings?.requestedType || 'random',
        } : {
          action: 'create_question',
          sessionId,
          presenterToken,
          screenshotId: prepared.screenshotId,
          storagePath: prepared.storagePath,
          questionType: type,
          options,
          allowMultiple,
          promptText,
        },
      })
      if (error) throw new Error(await edgeFunctionErrorMessage(error, '截圖派題失敗。'))
      if (!data?.question) throw new Error(data?.message || '建立題目失敗。')
      setSelectedQuestionId(data.question.id)
    } finally {
      setBusy(false)
    }
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

  async function createScreenshotQuestion(type: QuestionType, options: string[], allowMultiple: boolean, promptText: string, quizSettings?: CustomQuizSettings) {
    if (!captureFile) return

    setAnalysisError('')
    setEditorOpen(false)
    try {
      await uploadQuestionScreenshot(captureFile, type, options, allowMultiple, promptText, quizSettings)
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
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) throw new Error('找不到講者權限，請重新加入場次。')
    const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
      body: {
        action: 'stop_question',
        sessionId,
        presenterToken,
        questionId: session.current_question_id,
      },
    })
    if (error) throw error
    if (!data?.question) throw new Error(data?.message || '停止作答失敗。')
  }

  async function setCorrectAnswer(answer: string) {
    if (!question || question.status === 'active') return
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) throw new Error('找不到講者權限，請重新加入場次。')
    const currentCorrectAnswers = question.correct_answers || []
    const correctAnswers = question.allow_multiple
      ? currentCorrectAnswers.includes(answer)
        ? currentCorrectAnswers.filter((option: string) => option !== answer)
        : [...currentCorrectAnswers, answer]
      : [answer]

    const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
      body: {
        action: 'grade_question',
        sessionId,
        presenterToken,
        questionId: question.id,
        correctAnswers,
      },
    })
    if (error) throw error
    if (!Array.isArray(data?.correctAnswers)) throw new Error(data?.message || '答案設定失敗。')
    setQuestion({
      ...question,
      correct_answer: question.allow_multiple ? null : data.correctAnswers[0] || null,
      correct_answers: data.correctAnswers,
    })
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
      // The class picture is built from the individual marks, so whatever is
      // still unmarked gets marked first. One request per student, not per file:
      // a whole class in a single call would outlive the function that sent it.
      // Work already paid for is skipped, and one unreadable photo stops nothing.
      if (question.type === 'file_upload') {
        const unmarked = fileResponses.filter((item) => item.question_id === question.id
          && ['pending', 'failed'].includes(item.analysis_status))
        // Marking is per student, so a submission of three pages is one unit of
        // work; counting pages would promise more presses than it makes.
        const pending = [...new Set(unmarked.map((item) => item.participant_id))]
          .map((participantId) => unmarked.find((item) => item.participant_id === participantId))
          .filter((item): item is FileResponse => Boolean(item))
        for (const [index, item] of pending.entries()) {
          setGradeProgress({ done: index, total: pending.length })
          try {
            await analyzeFileResponse(item.id)
          } catch {
            // The failure is recorded on the row itself; the rest still gets marked.
          }
        }
        setGradeProgress(null)
        await refreshFileResponses()
      }
      const { data, error } = await requireSupabase().functions.invoke('analyze-question', {
        body: { sessionId, questionId: question.id, presenterToken },
      })
      if (error) {
        const response = (error as Error & { context?: Response }).context
        let responseMessage = ''
        if (response) {
          try {
            const payload = await response.clone().json() as { message?: unknown }
            if (typeof payload.message === 'string') responseMessage = payload.message.trim()
          } catch {
            // Use the SDK message when the response is not JSON.
          }
        }
        if (responseMessage) throw new Error(responseMessage)
        throw error
      }
      if (!data?.analysis) throw new Error(data?.message || 'AI 沒有回傳分析結果。')
      setAnalysis(data.analysis as QuestionAnalysis)
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : 'AI 分析失敗。')
    } finally {
      setAnalysisBusy(false)
      setGradeProgress(null)
    }
  }

  async function updateCustomQuizAnswer(itemId: string, acceptedAnswers: string[]) {
    if (!question || question.type !== 'custom_quiz') return
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) throw new Error('這個舊場次沒有講者修改答案的權限。')
    const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
      body: {
        action: 'update_custom_quiz_key',
        sessionId,
        presenterToken,
        questionId: question.id,
        itemId,
        acceptedAnswers,
      },
    })
    if (error) throw new Error(await edgeFunctionErrorMessage(error, '正確答案更新失敗。'))
    if (!data?.success) throw new Error(data?.message || '正確答案更新失敗。')
    await loadAll()
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
    await runLottery(onlineParticipants.map((participant) => participant.id), '目前沒有線上學生。')
  }

  async function startBuzzer() {
    if (!onlineParticipants.length) {
      setAnalysisError('目前沒有線上學生。')
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
      setAnalysisError('目前沒有線上學生。')
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
        setAnalysisError('目前線上學生皆已作答此題。')
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



  // One fetch feeds both places uploads are shown; each takes the question it
  // is actually displaying rather than assuming they are the same one.
  const questionFileResponses = useMemo(
    () => question ? fileResponses.filter((item) => item.question_id === question.id) : [],
    [fileResponses, question],
  )
  const collectFileResponses = useMemo(
    () => collectQuestion ? fileResponses.filter((item) => item.question_id === collectQuestion.id) : [],
    [collectQuestion, fileResponses],
  )

  // Keep the collection tab pointing at the newest file_upload question so reopening
  // the modal (or reloading the page mid-class) shows what is currently being collected.
  useEffect(() => {
    const latest = questions.filter((item) => item.type === 'file_upload').at(-1) || null
    setCollectQuestion((current) => current?.id === latest?.id ? current : latest)
  }, [questions])

  function requirePresenterToken() {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) throw new Error('這個舊場次沒有講者操作權限，請建立新場次後再試。')
    return presenterToken
  }

  async function callPresenter(body: Record<string, unknown>, fallback: string) {
    const { data, error } = await requireSupabase().functions.invoke('presenter-action', { body })
    if (error) throw new Error(await edgeFunctionErrorMessage(error, fallback))
    return data as Record<string, unknown>
  }

  const refreshSharedFiles = useCallback(async () => {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) return
    const { data } = await requireSupabase().functions.invoke('presenter-action', {
      body: { action: 'list_shared_files', sessionId, presenterToken },
    })
    setSharedFiles((data?.files || []) as SharedFile[])
  }, [sessionId])

  // Same question type and the same result view as a screenshot quiz; only the
  // material Gemini reads is different.
  async function createFileQuiz(fileId: string, settings: CustomQuizSettings) {
    const presenterToken = requirePresenterToken()
    setBusy(true)
    try {
      await callPresenter({
        action: 'create_custom_quiz',
        sessionId,
        presenterToken,
        sharedFileId: fileId,
        direction: settings.direction,
        requestedCount: settings.requestedCount,
        requestedType: settings.requestedType,
      }, 'AI 出題失敗。')
    } finally {
      setBusy(false)
    }
  }

  async function shareFiles(files: File[]) {
    const presenterToken = requirePresenterToken()
    const supabase = requireSupabase()
    setBusy(true)
    try {
      for (const file of files) {
        const prepared = await callPresenter({
          action: 'prepare_shared_file_upload',
          sessionId,
          presenterToken,
          fileName: file.name,
          fileSize: file.size,
        }, '無法準備檔案上傳。')
        const { error: uploadError } = await supabase.storage
          .from('interact-files')
          .uploadToSignedUrl(prepared.storagePath as string, prepared.uploadToken as string, file, {
            contentType: file.type || 'application/octet-stream',
            upsert: false,
          })
        if (uploadError) throw uploadError
        await callPresenter({
          action: 'submit_shared_file',
          sessionId,
          presenterToken,
          storagePath: prepared.storagePath,
          fileName: file.name,
          mimeType: file.type,
          fileSize: file.size,
        }, '檔案上傳失敗。')
      }
      await refreshSharedFiles()
    } finally {
      setBusy(false)
    }
  }

  async function deleteSharedFile(fileId: string) {
    const presenterToken = requirePresenterToken()
    setBusy(true)
    try {
      await callPresenter({ action: 'delete_shared_file', sessionId, presenterToken, fileId }, '移除檔案失敗。')
      await refreshSharedFiles()
    } finally {
      setBusy(false)
    }
  }

  // Every upload in the session, not just the question the modal happens to be
  // on: the result panel shows whichever upload question the presenter selected.
  const refreshFileResponses = useCallback(async () => {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) return
    const { data } = await requireSupabase().functions.invoke('presenter-action', {
      body: { action: 'get_file_responses', sessionId, presenterToken },
    })
    setFileResponses((data?.responses || []) as FileResponse[])
  }, [sessionId])

  useEffect(() => {
    if (question?.type !== 'file_upload') return
    void refreshFileResponses()
    if (question.status !== 'active') return
    // Skipped while a mark is in flight: a reply issued before the mark landed
    // would put the row back to 「尚未批改」 for a beat.
    const timer = window.setInterval(() => {
      if (!markingRef.current) void refreshFileResponses()
    }, 10_000)
    return () => window.clearInterval(timer)
  }, [question?.id, question?.status, question?.type, refreshFileResponses])

  async function startFileCollect(promptText: string) {
    const presenterToken = requirePresenterToken()
    setBusy(true)
    try {
      const data = await callPresenter({
        action: 'create_file_request', sessionId, presenterToken, promptText,
      }, '無法派送檔案上傳。')
      setCollectQuestion(data.question as Question)
      setFileResponses([])
      await loadAll()
    } finally {
      setBusy(false)
    }
  }

  async function stopFileCollect() {
    const presenterToken = requirePresenterToken()
    if (!collectQuestion) return
    setBusy(true)
    try {
      await callPresenter({
        action: 'stop_question', sessionId, presenterToken, questionId: collectQuestion.id,
      }, '無法停止收件。')
      setCollectQuestion({ ...collectQuestion, status: 'stopped' })
      await refreshFileResponses()
      await loadAll()
    } finally {
      setBusy(false)
    }
  }

  // One press marks the student, not the file: the backend reads all the pages
  // they sent together and returns every row it touched.
  async function analyzeFileResponse(responseId: string) {
    const presenterToken = requirePresenterToken()
    setFileBusyId(responseId)
    markingRef.current = true
    try {
      const data = await callPresenter({
        action: 'analyze_file_response', sessionId, presenterToken, responseId,
      }, 'AI 批改失敗。')
      const updated = (data.responses as FileResponse[] | undefined)
        || (data.response ? [data.response as FileResponse] : [])
      if (updated.length) {
        const byId = new Map(updated.map((item) => [item.id, item]))
        setFileResponses((current) => current.map((item) => byId.get(item.id) || item))
      }
      return updated
    } finally {
      setFileBusyId('')
      markingRef.current = false
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
        timeout: 15_000,
      })
      if (error) throw new Error(await edgeFunctionErrorMessage(error, '文字派送失敗。'))
      if (!data?.content) throw new Error(data?.message || '文字派送失敗。')
      setTextDispatchOpen(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : '文字派送失敗。'
      logDiagnostic('shared_content_failed', { sessionId, message })
      setTextDispatchError(message)
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
      if (captionConnectionsRef.current.length) await stopCourseRecording()
      if (window.interactDesktop) {
        await window.interactDesktop.openSessionReport(sessionId, true)
      } else {
        window.location.hash = `/session-report/${sessionId}?generate=1`
      }
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '無法開啟課堂報告。')
      setBusy(false)
    }
  }

  async function confirmEndClass() {
    await endClass()
    setEndClassConfirmOpen(false)
  }

  async function closeSessionAndApp() {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setCloseConfirmOpen(false)
      setAnalysisError('找不到這個場次的講者權限，無法安全結束課程。')
      return
    }

    setClosingSession(true)
    setAnalysisError('')
    try {
      if (captionConnectionsRef.current.length) await stopCourseRecording()
      await endManagedSession(sessionId, presenterToken)
      await window.interactDesktop?.close()
    } catch (error) {
      setCloseConfirmOpen(false)
      setAnalysisError(error instanceof Error ? error.message : '無法結束課程，程式尚未關閉。')
      setClosingSession(false)
    }
  }

  async function suspendSessionAndCloseApp() {
    setClosingSession(true)
    setAnalysisError('')
    try {
      if (captionConnectionsRef.current.length) await stopCourseRecording()
      await window.interactDesktop?.close()
    } catch (error) {
      setCloseConfirmOpen(false)
      setAnalysisError(error instanceof Error ? error.message : '暫時中止失敗，程式尚未關閉。')
      setClosingSession(false)
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
    <main className={`presenter-page${controlsOpen ? ' controls-open' : ''}${settingsOpen ? ' settings-open' : ''}${selectionMode ? ' selecting-capture' : ''}`}>
      {!selectionMode && (
        <aside className="qr-floating">
          <QRCodePanel
            joinUrl={joinUrl}
            onClose={window.interactDesktop ? () => setCloseConfirmOpen(true) : undefined}
            onMinimize={window.interactDesktop ? () => window.interactDesktop?.minimize() : undefined}
            qrInteractionProps={{
              onDoubleClick: (event) => {
                event.preventDefault()
                event.stopPropagation()
                setControlsOpen((current) => !current)
              },
            }}
          />
        </aside>
      )}
      {controlsOpen && (
        <aside className="presenter-controls-overlay" onDoubleClick={(event) => event.stopPropagation()}>
        <PresenterControlPanel
          busy={busy}
          buzzerActive={isBuzzerPending(buzzerEvent)}
          captionError={captionError}
          onlineCount={onlineParticipants.length}
          session={session}
          onDrawLottery={drawLottery}
          onStartBuzzer={startBuzzer}
          onStopQuestion={stopQuestion}
          onToggleAnonymous={() => updateSession({ anonymous_enabled: !session.anonymous_enabled })}
          onToggleDanmaku={() => updateSession({ danmaku_enabled: !session.danmaku_enabled })}
          onCaptureScreen={window.interactDesktop ? captureWindowsScreen : undefined}
          onGenerateExitTicket={generateExitTicket}
          onEndClass={() => setEndClassConfirmOpen(true)}
          onOpenFileTransfer={() => {
            setFileTransferOpen(true)
            void refreshSharedFiles()
          }}
          onOpenTextDispatch={() => {
            setTextDispatchError('')
            setTextDispatchOpen(true)
          }}
          onOpenSettings={openPresenterSettings}
          onOpenRoster={() => void window.interactDesktop?.openRoster(sessionId)}
          onOpenWordCloud={openWordCloud}
          onToggleRecording={toggleCourseRecording}
          onToggleCaptionVisibility={toggleCaptionVisibility}
        />
        <QuestionHistory
          activeQuestionId={session.current_question_id}
          answerCounts={answerCounts}
          questions={questions}
          selectedQuestionId={selectedQuestionId}
          onSelect={selectQuestion}
        />
        {question?.type === 'custom_quiz' ? (
          <CustomQuizResult
            anonymousEnabled={session.anonymous_enabled}
            onlineCount={onlineParticipants.length}
            question={question}
            results={quizResults}
            onUpdateAnswer={updateCustomQuizAnswer}
          />
        ) : <QuestionResult
          anonymousEnabled={session.anonymous_enabled}
          analysis={analysis}
          analysisBusy={analysisBusy}
          analysisError={analysisError}
          answers={answers}
          audioResponses={audioResponses}
          busy={busy}
          fileBusyId={fileBusyId}
          fileResponses={questionFileResponses}
          gradeProgress={gradeProgress}
          isCurrentQuestion={question?.id === session.current_question_id}
          onlineCount={onlineParticipants.length}
          question={question}
          onAnalyze={analyzeQuestion}
          onAnalyzeFile={(responseId) => void analyzeFileResponse(responseId).catch((error) => {
            setAnalysisError(error instanceof Error ? error.message : 'AI 批改失敗。')
          })}
          onDrawUnanswered={drawUnanswered}
          onSetCorrectAnswer={setCorrectAnswer}
        />}
        {session.exit_ticket_prompt && session.exit_ticket_category && (
          <ExitTicketResult
            anonymousEnabled={session.anonymous_enabled}
            category={session.exit_ticket_category}
            onlineCount={onlineParticipants.length}
            prompt={session.exit_ticket_prompt}
            tickets={exitTickets}
          />
        )}
      </aside>
      )}
      {!window.interactDesktop && session.captions_enabled && (
        <LiveCaptionOverlay
          fontBold={session.caption_font_bold}
          fontSize={session.caption_font_size}
          position={session.caption_position}
          status={session.caption_status}
          text={liveCaptions[resolvedCaptionLanguage(session.caption_display_language, session.caption_source_language)] || ''}
        />
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
      {fileTransferOpen && (
        <FileTransferModal
          busy={busy}
          collectQuestion={collectQuestion}
          fileBusyId={fileBusyId}
          fileResponses={collectFileResponses}
          sharedFiles={sharedFiles}
          onAnalyzeResponse={async (responseId) => { await analyzeFileResponse(responseId) }}
          onClose={() => setFileTransferOpen(false)}
          onDeleteSharedFile={deleteSharedFile}
          onRefreshResponses={refreshFileResponses}
          onCreateFileQuiz={createFileQuiz}
          onShareFiles={shareFiles}
          onStartCollect={startFileCollect}
          onStopCollect={stopFileCollect}
        />
      )}
      <TextDispatchModal
        busy={busy}
        error={textDispatchError}
        open={textDispatchOpen}
        onCancel={() => setTextDispatchOpen(false)}
        onSend={sendSharedContent}
      />
      <PresenterSettingsModal
        busy={settingsBusy}
        error={settingsError}
        microphones={microphones}
        open={settingsOpen}
        selectedMicrophoneId={selectedMicrophoneId}
        session={session}
        onClose={() => {
          if (!settingsBusy) setSettingsOpen(false)
        }}
        onRefreshMicrophones={() => void refreshMicrophones()}
        onSave={(settings, microphoneId) => void savePresenterSettings(settings, microphoneId)}
      />
      <ConfirmDialog
        busy={busy}
        confirmLabel="下課並產生報告"
        description={`「${session.title}」會停止互動，學員將看到課程已結束；課堂資料、派送內容與分析都會保留。`}
        open={endClassConfirmOpen}
        title="確定要下課並產生報告？"
        onCancel={() => {
          if (!busy) setEndClassConfirmOpen(false)
        }}
        onConfirm={confirmEndClass}
      />
      <ConfirmDialog
        busy={closingSession}
        confirmLabel="結束課程並離開"
        description={`暫時中止只會關閉講師程式，場次與資料保持原狀，可從「管理場次」重新加入。選擇結束課程後，學員會看到課程已結束，資料保留但不產生 AI 課程總結。`}
        open={closeConfirmOpen}
        secondaryLabel="暫時中止"
        title={`要如何離開「${session.title}」？`}
        onCancel={() => {
          if (!closingSession) setCloseConfirmOpen(false)
        }}
        onConfirm={closeSessionAndApp}
        onSecondary={suspendSessionAndCloseApp}
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
