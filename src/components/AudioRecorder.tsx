import { CircleStop, Mic, RotateCcw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { recordingToWav } from '../lib/audio'
import { formatSeconds } from '../lib/questionTiming'
import type { AudioResponse, Question } from '../types'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'

type Props = {
  busy: boolean
  question: Question
  response: AudioResponse | null
  onSubmit: (file: File, durationMs: number) => Promise<void>
  locale?: ParticipantLocale
}

const MAX_DURATION_MS = 180_000

function formatDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function AudioRecorder({ busy, question, response, onSubmit, locale = 'zh-TW' }: Props) {
  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [preparingLeft, setPreparingLeft] = useState<number | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const startedAtRef = useRef(0)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)

  function releaseMicrophone() {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }

  useEffect(() => () => {
    cancelledRef.current = true
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    releaseMicrophone()
  }, [question.id])

  // A spoken answer is not bounded by the session's wall clock — the upload that
  // follows can take a while, and a server deadline would throw away recordings
  // that were made in time. What bounds it is the recorder itself.
  const maxDurationMs = question.answer_seconds ? question.answer_seconds * 1000 : MAX_DURATION_MS

  useEffect(() => {
    if (!recording) return
    const timer = window.setInterval(() => {
      const next = Date.now() - startedAtRef.current
      setElapsed(next)
      if (next >= maxDurationMs && recorderRef.current?.state === 'recording') recorderRef.current.stop()
    }, 200)
    return () => window.clearInterval(timer)
  }, [maxDurationMs, recording])

  // The preparation clock starts when the student opens the question, and
  // reaching zero starts the recording rather than merely unlocking the button:
  // a challenge that then waits for another tap is not a timed challenge.
  useEffect(() => {
    if (!question.prepare_seconds || response || question.status !== 'active') return
    setPreparingLeft(question.prepare_seconds)
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((question.prepare_seconds! * 1000 - (Date.now() - startedAt)) / 1000))
      setPreparingLeft(left)
      if (left === 0) {
        window.clearInterval(timer)
        setPreparingLeft(null)
        void startRecording()
      }
    }, 250)
    return () => window.clearInterval(timer)
    // Deliberately keyed on the question alone: re-running this when the
    // recording starts would restart the countdown that just fired it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id, question.prepare_seconds, question.status])

  async function startRecording() {
    setError('')
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('此瀏覽器不支援錄音，請改用最新版 Chrome、Edge 或 Safari。')
      return
    }
    try {
      cancelledRef.current = false
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      streamRef.current = stream
      const preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined)
      recorderRef.current = recorder
      chunksRef.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        setError('錄音失敗，請確認麥克風權限後重試。')
        setRecording(false)
        releaseMicrophone()
      }
      recorder.onstop = async () => {
        const durationMs = Math.min(maxDurationMs, Date.now() - startedAtRef.current)
        setRecording(false)
        releaseMicrophone()
        if (cancelledRef.current) return
        if (durationMs < 500) {
          setError('錄音時間太短，請至少說半秒後再停止。')
          return
        }
        try {
          const source = new Blob(chunksRef.current, { type: recorder.mimeType })
          const wav = await recordingToWav(source)
          await onSubmit(new File([wav], `interact-${question.id}.wav`, { type: 'audio/wav' }), durationMs)
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : '錄音處理失敗，請重新錄製。')
        }
      }
      startedAtRef.current = Date.now()
      setElapsed(0)
      setRecording(true)
      recorder.start(250)
    } catch {
      setError('無法使用麥克風，請在瀏覽器網址列允許麥克風權限。')
      releaseMicrophone()
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  if (response) {
    const originalAnalysis = response.analysis_json
    const analysis = locale === 'en' ? originalAnalysis?.translations?.en || originalAnalysis : originalAnalysis
    return (
      <div className="audio-response-card" aria-live="polite">
        {question.status === 'active' ? (
          <p className="success">{participantText(locale, 'recordingSent')}</p>
        ) : response.analysis_status === 'success' && analysis ? (
          <>
            <div className="audio-feedback-heading">
              <div>
                <h3>{participantText(locale, 'personalAssessment')}</h3>
                <p className="muted">{participantText(locale, 'detectedLanguage')}{analysis.detected_language}</p>
              </div>
              <div className="audio-score"><strong>{analysis.score}</strong><span>{participantText(locale, 'points')}</span></div>
            </div>
            <p className="audio-feedback-summary">{analysis.summary}</p>
            {response.signed_url && <audio controls preload="metadata" src={response.signed_url} />}
            <div className="audio-analysis-grid">
              <div><strong>{participantText(locale, 'relevance')}</strong><p>{analysis.relevance}</p></div>
              <div><strong>{participantText(locale, 'clarity')}</strong><p>{analysis.clarity}</p></div>
              <div><strong>{participantText(locale, 'completeness')}</strong><p>{analysis.completeness}</p></div>
            </div>
            <div className="audio-feedback-section"><strong>{participantText(locale, 'doneWell')}</strong><ul>{analysis.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <div className="audio-feedback-section"><strong>{participantText(locale, 'nextStep')}</strong><ul>{analysis.improvements.map((item) => <li key={item}>{item}</li>)}</ul></div>
            <details><summary>{participantText(locale, 'transcript')}</summary><p>{analysis.transcript || participantText(locale, 'noTranscript')}</p></details>
          </>
        ) : response.analysis_status === 'failed' ? (
          <p className="error">{participantText(locale, 'assessmentFailed')}</p>
        ) : (
          <p className="muted">{participantText(locale, 'assessmentPending')}</p>
        )}
      </div>
    )
  }

  return (
    <div className="audio-recorder">
      {/* The limit the teacher actually set, not the ceiling built into the app:
          telling a student "up to 3 minutes" and cutting them off at 30 seconds
          is worse than saying nothing. */}
      <p className="muted">
        {participantText(locale, 'recordingLimit')} {formatSeconds(Math.round(maxDurationMs / 1000), locale)}。
        {participantText(locale, 'recordingHint')}
      </p>
      {preparingLeft !== null && (
        <p aria-live="off" className={`answer-countdown${preparingLeft <= 3 ? ' is-urgent' : ''}`}>
          {participantText(locale, 'preparing')} {preparingLeft}
        </p>
      )}
      <button
        className={recording ? 'recording-button active' : 'recording-button'}
        disabled={busy || preparingLeft !== null}
        type="button"
        onClick={recording ? stopRecording : startRecording}
      >
        {recording ? <CircleStop size={28} /> : busy ? <RotateCcw className="spin" size={28} /> : <Mic size={28} />}
        <span>{recording
          ? `${participantText(locale, 'stopRecording')} ${formatDuration(question.answer_seconds ? maxDurationMs - elapsed : elapsed)}`
          : busy ? participantText(locale, 'uploading') : participantText(locale, 'startRecording')}</span>
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
