import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, PencilLine, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { getPresenterToken } from '../lib/presenterAuth'
import { requireSupabase } from '../lib/supabase'
import type { FileResponse, Question } from '../types'

const verdictLabels: Record<string, string> = {
  correct: '正確',
  partial: '部分正確',
  incorrect: '不正確',
  unscored: '已批閱',
}

function isImage(response: FileResponse) {
  return response.mime_type.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(response.name)
}

// Marking a class of handwritten answers means looking at each page properly.
// The results panel beside the class list is a column a few hundred pixels
// wide, so this is the same pages at the size they were written on, in their
// own window — the gesture 圖上點選 and 討論板 already use.
export function SubmissionReviewPage() {
  const { sessionId = '', questionId = '' } = useParams()
  const [question, setQuestion] = useState<Question | null>(null)
  const [responses, setResponses] = useState<FileResponse[]>([])
  const [anonymous, setAnonymous] = useState(false)
  const [at, setAt] = useState(0)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setError('找不到講者權限，請關閉視窗後重新開啟。')
      return
    }
    const supabase = requireSupabase()
    const [{ data: questionRow }, { data, error: loadError }] = await Promise.all([
      supabase.from('questions').select('*').eq('id', questionId).maybeSingle(),
      supabase.functions.invoke('presenter-action', {
        body: { action: 'get_file_responses', sessionId, presenterToken, questionId },
      }),
    ])
    if (loadError) {
      setError(data?.message || '無法載入這一題的作答。')
      return
    }
    if (questionRow) setQuestion(questionRow as Question)
    setResponses((data?.responses || []) as FileResponse[])
    setError('')
  }, [questionId, sessionId])

  useEffect(() => {
    void load()
    // Students keep handing in while the window is open, and the teacher keeps
    // marking from the panel behind it; both should show up here.
    const timer = window.setInterval(() => void load(), 4000)
    return () => window.clearInterval(timer)
  }, [load])

  // One entry per page, grouped so a student's own pages stay together and the
  // mark that covers them all travels with each one.
  const pages = useMemo(() => {
    const byStudent = new Map<string, FileResponse[]>()
    for (const response of responses) {
      const kept = byStudent.get(response.participant_id)
      if (kept) kept.push(response)
      else byStudent.set(response.participant_id, [response])
    }
    return [...byStudent.values()].flatMap((files, index) => {
      const marked = files.find((file) => file.analysis_status === 'success' && file.analysis_json) || files[0]
      const readable = files.filter((file) => isImage(file) && file.file_url)
      return readable.map((file, page) => ({
        id: file.id,
        url: file.file_url as string,
        name: file.name,
        owner: anonymous ? `匿名作答 ${index + 1}` : file.participant_name,
        page: readable.length > 1 ? `第 ${page + 1} / ${readable.length} 頁` : '',
        status: marked.analysis_status,
        analysis: marked.analysis_json,
      }))
    })
  }, [anonymous, responses])

  const total = pages.length
  const index = total ? Math.min(at, total - 1) : 0
  const current = pages[index]

  const move = useCallback((delta: number) => {
    setAt((now) => (total ? (now + delta + total) % total : 0))
  }, [total])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void window.interactDesktop?.close()
      if (event.key === 'ArrowRight' || event.key === 'PageDown') move(1)
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') move(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move])

  const analysis = current?.analysis || null

  return (
    <main className="submission-review-window">
      <header>
        <div>
          <p className="eyebrow"><PencilLine size={17} />{question?.type === 'drawing' ? '電寫題檢視' : '上傳作答檢視'}</p>
          <h1>{question?.prompt_text || question?.title || '學生作答'}</h1>
        </div>
        <label className="show-answers-toggle">
          <input checked={anonymous} type="checkbox" onChange={(event) => setAnonymous(event.target.checked)} />
          匿名顯示
        </label>
        <button aria-label="關閉檢視視窗" className="icon-button" title="關閉" type="button" onClick={() => void window.interactDesktop?.close()}>
          <X size={24} />
        </button>
      </header>

      {error && <p className="error">{error}</p>}
      {!error && !total && <p className="muted">還沒有可以看的作答。</p>}

      {current && (
        <div className="submission-review-body">
          <div className="submission-review-stage">
            <button aria-label="上一份" className="icon-button" disabled={total < 2} type="button" onClick={() => move(-1)}>
              <ChevronLeft size={30} />
            </button>
            <img alt={current.name} src={current.url} />
            <button aria-label="下一份" className="icon-button" disabled={total < 2} type="button" onClick={() => move(1)}>
              <ChevronRight size={30} />
            </button>
          </div>

          <aside className="submission-review-side">
            <div className="submission-review-who">
              <strong>{current.owner}</strong>
              {current.page && <span className="muted">{current.page}</span>}
              <span className="submission-review-count">{index + 1} / {total}</span>
            </div>
            {analysis ? (
              <>
                <div className="submission-review-verdict">
                  {analysis.verdict && (
                    <span className={`file-verdict is-${analysis.verdict}`}>{verdictLabels[analysis.verdict] || analysis.verdict}</span>
                  )}
                  {typeof analysis.score === 'number' && <span className="upload-score">{analysis.score} 分</span>}
                </div>
                <p>{analysis.summary_zh_tw}</p>
                {analysis.strengths_zh_tw.length > 0 && (
                  <>
                    <h2>做得好</h2>
                    <ul>{analysis.strengths_zh_tw.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                  </>
                )}
                {analysis.improvements_zh_tw.length > 0 && (
                  <>
                    <h2>可改進</h2>
                    <ul>{analysis.improvements_zh_tw.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                  </>
                )}
              </>
            ) : (
              <p className="muted">
                {current.status === 'analyzing' ? '批改中…'
                  : current.status === 'unsupported' ? 'AI 無法讀取這個格式。'
                  : '這一份還沒批改。批改的按鈕在後面的作答面板上。'}
              </p>
            )}
          </aside>
        </div>
      )}

      {total > 1 && (
        // Thirty students is thirty presses of an arrow to reach the last one.
        <nav className="submission-review-strip" aria-label="所有作答">
          {pages.map((page, pageIndex) => (
            <button
              aria-current={pageIndex === index}
              aria-label={page.owner}
              className={`submission-review-chip${pageIndex === index ? ' is-current' : ''}`}
              key={page.id}
              title={page.owner}
              type="button"
              onClick={() => setAt(pageIndex)}
            >
              <img alt="" src={page.url} />
            </button>
          ))}
        </nav>
      )}
    </main>
  )
}
