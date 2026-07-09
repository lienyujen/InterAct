import { useCallback, useEffect, useMemo, useState } from 'react'
import { DanmakuLayer } from '../components/DanmakuLayer'
import { PresenterControlPanel } from '../components/PresenterControlPanel'
import { QRCodePanel } from '../components/QRCodePanel'
import { QuestionEditor } from '../components/QuestionEditor'
import { QuestionResult } from '../components/QuestionResult'
import { SetupNotice } from '../components/SetupNotice'
import { buildJoinUrl } from '../lib/qrcode'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'
import type { Answer, Message, Participant, Question, QuestionType, Screenshot, Session } from '../types'
import { useParams } from 'react-router-dom'

export function PresenterPage() {
  const { sessionId = '' } = useParams()
  const [session, setSession] = useState<Session | null>(null)
  const [participants, setParticipants] = useState<Participant[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [question, setQuestion] = useState<Question | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [latestScreenshot, setLatestScreenshot] = useState<Screenshot | null>(null)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [captureFile, setCaptureFile] = useState<File | null>(null)
  const [capturePreviewUrl, setCapturePreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const joinUrl = useMemo(() => buildJoinUrl(sessionId), [sessionId])

  const loadAll = useCallback(async () => {
    if (!isSupabaseConfigured || !sessionId) return

    const supabase = requireSupabase()
    const [{ data: sessionData }, { data: participantData }, { data: messageData }, { data: screenshotData }] = await Promise.all([
      supabase.from('sessions').select('*').eq('id', sessionId).single(),
      supabase.from('participants').select('*').eq('session_id', sessionId).order('joined_at'),
      supabase.from('messages').select('*').eq('session_id', sessionId).order('created_at'),
      supabase.from('screenshots').select('*').eq('session_id', sessionId).order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])

    const nextSession = sessionData as Session | null
    setSession(nextSession)
    setParticipants((participantData || []) as Participant[])
    setMessages((messageData || []) as Message[])
    setLatestScreenshot((screenshotData as Screenshot | null) || null)

    if (nextSession?.current_question_id) {
      const [{ data: questionData }, { data: answerData }] = await Promise.all([
        supabase.from('questions').select('*').eq('id', nextSession.current_question_id).single(),
        supabase.from('answers').select('*').eq('question_id', nextSession.current_question_id).order('submitted_at'),
      ])
      setQuestion(questionData as Question | null)
      setAnswers((answerData || []) as Answer[])
    }
  }, [sessionId])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (!isSupabaseConfigured || !sessionId) return
    const supabase = requireSupabase()
    const channel = supabase
      .channel(`presenter:${sessionId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'questions', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answers', filter: `session_id=eq.${sessionId}` }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screenshots', filter: `session_id=eq.${sessionId}` }, loadAll)
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [loadAll, sessionId])

  async function updateSession(values: Partial<Session>) {
    if (!session) return
    setBusy(true)
    try {
      await requireSupabase().from('sessions').update(values).eq('id', session.id)
    } finally {
      setBusy(false)
    }
  }

  async function uploadQuestionScreenshot(file: File, type: QuestionType, options: string[]) {
    setBusy(true)
    try {
      const supabase = requireSupabase()
      const screenshotId = crypto.randomUUID()
      const path = `sessions/${sessionId}/screenshots/${screenshotId}-${file.name}`
      const { error: uploadError } = await supabase.storage.from('interact-screenshots').upload(path, file, { upsert: true })
      if (uploadError) throw uploadError
      const { data: publicData } = supabase.storage.from('interact-screenshots').getPublicUrl(path)
      const { data: screenshotData, error: insertError } = await supabase
        .from('screenshots')
        .insert({ id: screenshotId, session_id: sessionId, storage_path: path, public_url: publicData.publicUrl, ai_status: 'skipped' })
        .select('*')
        .single()
      if (insertError) throw insertError
      const { data: questionData } = await supabase
        .from('questions')
        .insert({ session_id: sessionId, screenshot_id: screenshotId, type, status: 'active', title: questionTitle(type), options })
        .select('*')
        .single()
      await supabase.from('sessions').update({ current_question_id: questionData?.id }).eq('id', sessionId)
      setLatestScreenshot(screenshotData as Screenshot)
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

    const source = await window.interactDesktop.captureFirstScreen()
    const file = dataUrlToFile(source.thumbnailDataUrl, `windows-screen-${Date.now()}.png`)
    setCaptureFile(file)
    setCapturePreviewUrl(source.thumbnailDataUrl)
    setEditorOpen(true)
  }

  async function createScreenshotQuestion(type: QuestionType, options: string[]) {
    if (!captureFile) return

    setEditorOpen(false)
    await uploadQuestionScreenshot(captureFile, type, options)
    setCaptureFile(null)
    setCapturePreviewUrl(null)
  }

  function cancelQuestionEditor() {
    setEditorOpen(false)
    setCaptureFile(null)
    setCapturePreviewUrl(null)
  }

  async function stopQuestion() {
    if (!question) return
    await requireSupabase()
      .from('questions')
      .update({ status: 'stopped', stopped_at: new Date().toISOString() })
      .eq('id', question.id)
  }

  async function setCorrectAnswer(answer: string) {
    if (!question) return
    const supabase = requireSupabase()
    await supabase.from('questions').update({ correct_answer: answer }).eq('id', question.id)
    await supabase.from('answers').update({ is_correct: false }).eq('question_id', question.id)
    await supabase.from('answers').update({ is_correct: true }).eq('question_id', question.id).eq('answer_value', answer)
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
    <main className="presenter-page">
      <DanmakuLayer messages={messages} session={session} />
      <section className="stage" onDoubleClick={() => setControlsOpen((current) => !current)}>
        {latestScreenshot ? <img alt="派送圖片" className="stage-image" src={latestScreenshot.public_url} /> : <h1>{session.title}</h1>}
        <p className="double-click-hint">雙擊畫面開啟功能</p>
      </section>
      <aside className="qr-floating">
        <QRCodePanel code={session.code} joinUrl={joinUrl} />
      </aside>
      {controlsOpen && (
        <aside className="presenter-controls-overlay" onDoubleClick={(event) => event.stopPropagation()}>
        <PresenterControlPanel
          busy={busy}
          participants={participants}
          session={session}
          onStopQuestion={stopQuestion}
          onToggleAnonymous={() => updateSession({ anonymous_enabled: !session.anonymous_enabled })}
          onToggleDanmaku={() => updateSession({ danmaku_enabled: !session.danmaku_enabled })}
          onCaptureScreen={window.interactDesktop ? captureWindowsScreen : undefined}
        />
        <QuestionResult answers={answers} question={question} onSetCorrectAnswer={setCorrectAnswer} />
      </aside>
      )}
      <QuestionEditor open={editorOpen} previewUrl={capturePreviewUrl} onCancel={cancelQuestionEditor} onCreate={createScreenshotQuestion} />
    </main>
  )
}
