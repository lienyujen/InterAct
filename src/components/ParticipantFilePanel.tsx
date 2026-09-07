import { useEffect, useRef, useState } from 'react'
import { Camera, Download, FileUp, LoaderCircle, Sparkles, Upload } from 'lucide-react'
import { requireSupabase } from '../lib/supabase'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'
import { downloadHref, publicFileUrl } from '../lib/fileLinks'
import type { FileAnalysis, FileAnalysisStatus, SharedFile } from '../types'

type Props = {
  sessionId: string
  locale: ParticipantLocale
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}


export function ParticipantSharedFiles({ sessionId, locale }: Props) {
  const [files, setFiles] = useState<SharedFile[]>([])

  useEffect(() => {
    if (!sessionId) return
    const supabase = requireSupabase()
    let active = true

    async function load() {
      const { data } = await supabase.from('shared_files')
        .select('*').eq('session_id', sessionId).order('created_at')
      if (active) setFiles((data || []) as SharedFile[])
    }
    void load()

    const channel = supabase.channel(`shared-files:${sessionId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'shared_files', filter: `session_id=eq.${sessionId}`,
      }, () => void load())
      .subscribe()

    // A phone suspends the socket as soon as the browser goes to the background,
    // so every change made while the screen was off is missed. Without this the
    // list keeps offering files the teacher has already removed, and tapping one
    // returns a 404 from Storage.
    const onVisible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)

    return () => {
      active = false
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
      void supabase.removeChannel(channel)
    }
  }, [sessionId])

  if (!files.length) return null

  return (
    <section className="panel participant-shared-files">
      <h2><Download size={17} />{participantText(locale, 'teacherFiles')}</h2>
      <ul>
        {files.map((file) => (
          <li key={file.id}>
            <a
              href={downloadHref(file.file_url || publicFileUrl(file.storage_path), file.name)}
              rel="noreferrer"
              target="_blank"
            >
              {file.name}
            </a>
            <span className="muted">{formatSize(file.file_size)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

type UploadProps = {
  sessionId: string
  questionId: string
  participantId: string
  participantToken: string
  promptText: string | null
  // A question dispatched from a screenshot lives on the image, so it belongs
  // inside this panel rather than further down the page under everything else.
  imageUrl?: string | null
  active: boolean
  locale: ParticipantLocale
}

type StudentMark = {
  id: string
  name: string
  analysis_status: FileAnalysisStatus
  analysis_json: FileAnalysis | null
}

const verdictLabels: Record<string, { 'zh-TW': string; en: string }> = {
  correct: { 'zh-TW': '正確', en: 'Correct' },
  partial: { 'zh-TW': '部分正確', en: 'Partly correct' },
  incorrect: { 'zh-TW': '不正確', en: 'Incorrect' },
  unscored: { 'zh-TW': '已批閱', en: 'Reviewed' },
}

export function ParticipantFileUpload({
  sessionId,
  questionId,
  participantId,
  participantToken,
  promptText,
  imageUrl,
  active,
  locale,
}: UploadProps) {
  const [uploaded, setUploaded] = useState<string[]>([])
  const [marks, setMarks] = useState<StudentMark[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  // Phones and tablets get a shortcut straight to the camera. On a mouse-driven
  // machine `capture` is ignored, so the button would just be a second file
  // picker — hide it there rather than offer the same thing twice.
  const [hasCamera] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches
  ))

  // The mark lands minutes after the upload, whenever the teacher gets to it,
  // and file_responses is revoked from anon and kept out of the realtime
  // publication so a student cannot read the table. So the page asks for its
  // own rows instead, through the function that returns only theirs.
  useEffect(() => {
    if (!questionId || !participantToken) return
    let cancelled = false
    const supabase = requireSupabase()

    async function read() {
      const { data } = await supabase.functions.invoke('participant-action', {
        body: { action: 'get_file_result', sessionId, participantId, participantToken, questionId },
      })
      if (!cancelled) setMarks((data?.responses || []) as StudentMark[])
    }
    void read()

    const timer = window.setInterval(() => void read(), 12_000)
    // A phone suspends timers as soon as it goes to the background, so a student
    // who locked their screen while waiting would come back to the state they
    // left rather than to their mark.
    const onVisible = () => { if (document.visibilityState === 'visible') void read() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [participantId, participantToken, questionId, sessionId, uploaded.length])

  async function upload(files: File[]) {
    if (!files.length) return
    setBusy(true)
    setError('')
    const supabase = requireSupabase()
    try {
      for (const file of files) {
        const { data: prepared, error: prepareError } = await supabase.functions.invoke('participant-action', {
          body: {
            action: 'prepare_file_upload',
            sessionId,
            participantId,
            participantToken,
            questionId,
            fileName: file.name,
            fileSize: file.size,
          },
        })
        if (prepareError) throw prepareError
        if (!prepared?.uploadToken) throw new Error(prepared?.message || participantText(locale, 'uploadFailed'))

        const { error: uploadError } = await supabase.storage
          .from('interact-files')
          .uploadToSignedUrl(prepared.storagePath, prepared.uploadToken, file, {
            contentType: file.type || 'application/octet-stream',
            upsert: false,
          })
        if (uploadError) throw uploadError

        const { error: submitError } = await supabase.functions.invoke('participant-action', {
          body: {
            action: 'submit_file_response',
            sessionId,
            participantId,
            participantToken,
            questionId,
            storagePath: prepared.storagePath,
            fileName: file.name,
            mimeType: file.type,
            fileSize: file.size,
          },
        })
        if (submitError) throw submitError
        setUploaded((current) => [...current, file.name])
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : participantText(locale, 'uploadFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel participant-file-upload">
      <h2><FileUp size={17} />{participantText(locale, 'fileUpload')}</h2>
      {imageUrl && <img alt={participantText(locale, 'imageAlt')} className="participant-image participant-file-image" src={imageUrl} />}
      {promptText && <p className="participant-file-prompt">{promptText}</p>}
      {active ? (
        <>
          <div className="participant-upload-actions">
            <button disabled={busy} type="button" onClick={() => inputRef.current?.click()}>
              {busy ? <LoaderCircle className="spin" size={17} /> : <Upload size={17} />}
              {busy ? participantText(locale, 'fileUploading') : participantText(locale, 'chooseFile')}
            </button>
            {hasCamera && (
              <button disabled={busy} type="button" onClick={() => cameraRef.current?.click()}>
                <Camera size={17} />
                {participantText(locale, 'takePhoto')}
              </button>
            )}
          </div>
          <input
            accept="image/*,.pdf,.txt,.md,.csv,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.zip"
            hidden
            multiple
            ref={inputRef}
            type="file"
            onChange={(event) => {
              void upload(Array.from(event.target.files || []))
              event.target.value = ''
            }}
          />
          <input
            accept="image/*"
            capture="environment"
            hidden
            ref={cameraRef}
            type="file"
            onChange={(event) => {
              void upload(Array.from(event.target.files || []))
              event.target.value = ''
            }}
          />
        </>
      ) : <p className="muted">{participantText(locale, 'uploadClosed')}</p>}
      {error && <p className="error">{error}</p>}
      {uploaded.length > 0 && (
        <ul className="participant-uploaded-list">
          {uploaded.map((name, index) => <li key={`${index}-${name}`}><Sparkles size={13} />{name}</li>)}
        </ul>
      )}
      <StudentMarks locale={locale} marks={marks} />
    </section>
  )
}

// One student's own mark, in the language they are reading the class in. The
// analysis already carries both, so nothing is translated here at display time.
function StudentMarks({ locale, marks }: { locale: ParticipantLocale; marks: StudentMark[] }) {
  // Pages of one answer all carry the same mark, so showing it once is showing
  // it correctly — repeating it per file would read as several separate marks.
  const marked = marks.find((mark) => mark.analysis_status === 'success' && mark.analysis_json)
  const waiting = !marked && marks.some((mark) => mark.analysis_status === 'analyzing')
  if (!marked) {
    return waiting ? <p className="muted participant-mark-waiting">{participantText(locale, 'marking')}</p> : null
  }

  const result = marked.analysis_json as FileAnalysis
  const english = locale === 'en'
  const summary = english ? result.summary_en : result.summary_zh_tw
  const strengths = english ? result.strengths_en : result.strengths_zh_tw
  const improvements = english ? result.improvements_en : result.improvements_zh_tw
  const verdict = result.verdict ? verdictLabels[result.verdict] : null

  return (
    <section className="participant-mark">
      <h3>{participantText(locale, 'yourMark')}</h3>
      <div className="participant-mark-headline">
        {verdict && <span className={`file-verdict is-${result.verdict}`}>{verdict[locale]}</span>}
        {typeof result.score === 'number' && (
          <span className="participant-mark-score">{result.score}{participantText(locale, 'points')}</span>
        )}
      </div>
      <p>{summary}</p>
      {strengths.length > 0 && (
        <>
          <h4>{participantText(locale, 'didWell')}</h4>
          <ul>{strengths.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </>
      )}
      {improvements.length > 0 && (
        <>
          <h4>{participantText(locale, 'canImprove')}</h4>
          <ul>{improvements.map((item, index) => <li key={index}>{item}</li>)}</ul>
        </>
      )}
    </section>
  )
}
