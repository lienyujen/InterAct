import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookOpen, ChartNoAxesCombined, Clock, Download, ListChecks, LoaderCircle, MessageSquareText, RefreshCw, Users } from 'lucide-react'
import { getPresenterToken } from '../lib/presenterAuth'
import { useSessionReportBack } from '../lib/sessionReportNavigation'
import { requireSupabase } from '../lib/supabase'
import type { AiSummary, Answer, AudioResponse, CaptionSegment, ExitTicket, Message, Participant, Question, Screenshot, Session, SessionAnalysis, SessionCustomQuizResults, SessionMetrics, SessionEvent, SessionReportData, SharedContent, FileResponse } from '../types'
import { useParams, useSearchParams } from 'react-router-dom'

const PAGE_SIZE = 1000

type ReportThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH'

const reportModes: { level: ReportThinkingLevel; label: string; hint: string }[] = [
  { level: 'LOW', label: '快速', hint: 'gemini-3.7-flash · thinking low：最不容易逾時，建議先用這個' },
  { level: 'MEDIUM', label: '標準', hint: 'gemini-3.7-flash · thinking medium：分析較深入，較慢' },
  { level: 'HIGH', label: '深入', hint: 'gemini-3.7-flash · thinking high：最深入，最可能逾時' },
]

const questionTypeLabels: Record<Question['type'], string> = {
  send_screen: '派送畫面',
  poll: '投票題',
  multiple_choice: '選擇題',
  true_false: '是非題',
  short_answer: '問答題',
  pronunciation: '朗讀發音',
  oral_response: '口語表達',
  custom_quiz: '自訂測驗',
  file_upload: '檔案上傳',
}

async function fetchAllRows<T>(table: string, sessionId: string, orderColumn: string) {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await requireSupabase()
      .from(table)
      .select('*')
      .eq('session_id', sessionId)
      .order(orderColumn)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const page = (data || []) as T[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return rows
  }
}

async function edgeFunctionMessage(error: unknown) {
  if (!(error instanceof Error)) return '整節課 AI 分析失敗。'
  const context = (error as Error & { context?: Response }).context
  if (context) {
    try {
      const body = await context.clone().json()
      if (typeof body?.message === 'string') return body.message
    } catch {
      // Fall back to the SDK error message.
    }
  }
  return error.message
}

function formatPercent(value: number | null) {
  return value === null ? '未判定' : `${value.toFixed(1)}%`
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return <p className="muted">目前沒有足夠資料。</p>
  return <ul className="report-list">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
}

export function SessionReportPage() {
  const { sessionId = '' } = useParams()
  const [searchParams] = useSearchParams()
  const generateRequested = searchParams.get('generate') === '1'
  const returnToSessionManager = useSessionReportBack()
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null)
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null)
  const [reportData, setReportData] = useState<SessionReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [thinkingLevel, setThinkingLevel] = useState<ReportThinkingLevel>('LOW')
  const automaticLoadKeyRef = useRef('')

  const loadReportData = useCallback(async () => {
    const supabase = requireSupabase()
    const { data: session, error: sessionError } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
    if (sessionError) throw sessionError

    const [participants, messages, sharedContents, captionSegments, screenshots, questions, answers, aiSummaries, exitTickets, sessionEvents] = await Promise.all([
      fetchAllRows<Participant>('participants', sessionId, 'joined_at'),
      fetchAllRows<Message>('messages', sessionId, 'created_at'),
      fetchAllRows<SharedContent>('shared_contents', sessionId, 'created_at'),
      fetchAllRows<CaptionSegment>('caption_segments', sessionId, 'created_at'),
      fetchAllRows<Screenshot>('screenshots', sessionId, 'created_at'),
      fetchAllRows<Question>('questions', sessionId, 'created_at'),
      fetchAllRows<Answer>('answers', sessionId, 'submitted_at'),
      fetchAllRows<AiSummary>('ai_summaries', sessionId, 'created_at'),
      fetchAllRows<ExitTicket>('exit_tickets', sessionId, 'submitted_at'),
      fetchAllRows<SessionEvent>('session_events', sessionId, 'created_at'),
    ])

    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) throw new Error('找不到這個場次的講者權限，無法讀取錄音評測。')
    const [recordingResult, customQuizResult, fileResult] = await Promise.all([
      supabase.functions.invoke('presenter-action', {
        body: { action: 'get_session_recording_results', sessionId, presenterToken },
      }),
      supabase.functions.invoke('presenter-action', {
        body: { action: 'get_session_custom_quiz_results', sessionId, presenterToken },
      }),
      // Session-wide: the presenter analyses uploads per file, and the report
      // has to carry whatever was analysed by the time the class ended.
      supabase.functions.invoke('presenter-action', {
        body: { action: 'get_file_responses', sessionId, presenterToken },
      }),
    ])
    if (recordingResult.error) throw new Error(await edgeFunctionMessage(recordingResult.error))
    if (customQuizResult.error) throw new Error(await edgeFunctionMessage(customQuizResult.error))

    setReportData({
      session: session as Session,
      participants,
      messages,
      sharedContents,
      captionSegments,
      screenshots,
      questions,
      answers,
      audioResponses: (recordingResult.data?.responses || []) as AudioResponse[],
      fileResponses: (fileResult.data?.responses || []) as FileResponse[],
      customQuizResults: customQuizResult.data as SessionCustomQuizResults,
      aiSummaries,
      exitTickets,
      buzzerEvents: sessionEvents.filter((event) => event.event_type === 'buzzer'),
    })
  }, [sessionId])

  const generateReport = useCallback(async (level?: ReportThinkingLevel) => {
    setLoading(true)
    setError('')
    try {
      const presenterToken = getPresenterToken(sessionId)
      if (!presenterToken) throw new Error('找不到這個場次的講者權限，無法產生課堂報告。')

      const supabase = requireSupabase()
      const { data, error: functionError } = await supabase.functions.invoke('analyze-session', {
        body: { sessionId, presenterToken, ...(level ? { thinkingLevel: level } : {}) },
      })
      if (functionError) throw new Error(await edgeFunctionMessage(functionError))
      if (!data?.analysis || !data?.metrics) throw new Error(data?.message || 'AI 沒有回傳完整課堂分析。')

      setAnalysis(data.analysis as SessionAnalysis)
      setMetrics(data.metrics as SessionMetrics)
      await loadReportData()
    } catch (caught) {
      setError(await edgeFunctionMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [loadReportData, sessionId])

  const loadSavedReport = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const { data, error: summaryError } = await requireSupabase()
        .from('ai_summaries')
        .select('*')
        .eq('session_id', sessionId)
        .eq('type', 'exit_ticket_summary')
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (summaryError) throw summaryError

      const savedSummary = data as AiSummary | null
      const savedMetrics = savedSummary?.input_json?.metrics as SessionMetrics | undefined
      if (!savedSummary || !savedMetrics) {
        throw new Error('此場次是直接結束，未使用「下課並產生報告」，因此沒有 AI 課程總結。')
      }

      setAnalysis(savedSummary.output_json as SessionAnalysis)
      setMetrics(savedMetrics)
      await loadReportData()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '無法讀取課堂報告。')
    } finally {
      setLoading(false)
    }
  }, [loadReportData, sessionId])

  useEffect(() => {
    const loadKey = `${sessionId}:${generateRequested ? 'generate' : 'saved'}`
    if (automaticLoadKeyRef.current === loadKey) return
    automaticLoadKeyRef.current = loadKey
    if (generateRequested) {
      void generateReport()
    } else {
      void loadSavedReport()
    }
  }, [generateReport, generateRequested, loadSavedReport, sessionId])

  const questionMeta = useMemo(
    () => new Map((reportData?.questions || []).map((question, index) => [question.id, {
      number: index + 1,
      type: questionTypeLabels[question.type],
    }])),
    [reportData?.questions],
  )

  async function exportExcel() {
    if (!reportData || !analysis || !metrics) return
    setExporting(true)
    setError('')
    try {
      const { exportSessionReport } = await import('../lib/exportSessionReport')
      await exportSessionReport(reportData, analysis, metrics)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Excel 匯出失敗。')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <main className="session-report-page report-loading">
        <LoaderCircle className="spin" size={34} />
        <h1>{generateRequested ? 'AI 正在分析整節課' : '正在讀取課堂報告'}</h1>
        <p className="muted">
          {generateRequested ? '彙整字幕逐字稿、文字派送、題目、作答、彈幕與參與資料...' : '載入已產生的課堂分析與互動資料...'}
        </p>
        <button className="ghost-button" type="button" onClick={() => void returnToSessionManager()}>
          <ArrowLeft size={17} />返回場次管理
        </button>
      </main>
    )
  }

  if (error && (!analysis || !metrics || !reportData)) {
    return (
      <main className="session-report-page report-loading">
        <h1>報告尚未產生</h1>
        <p className="error">{error}</p>
        <fieldset className="report-mode-picker">
          <legend>分析模式</legend>
          {reportModes.map((mode) => (
            <label key={mode.level}>
              <input
                checked={thinkingLevel === mode.level}
                name="report-thinking-level"
                type="radio"
                value={mode.level}
                onChange={() => setThinkingLevel(mode.level)}
              />
              <span className="report-mode-label">{mode.label}</span>
              <span className="report-mode-hint">{mode.hint}</span>
            </label>
          ))}
        </fieldset>
        <div className="report-actions">
          <button type="button" onClick={() => void generateReport(thinkingLevel)}>
            <RefreshCw size={17} />產生課堂報告
          </button>
          <button className="ghost-button" type="button" onClick={() => void returnToSessionManager()}>
            <ArrowLeft size={17} />返回場次管理
          </button>
        </div>
      </main>
    )
  }

  if (!analysis || !metrics || !reportData) return null

  return (
    <main className="session-report-page">
      <header className="report-header">
        <div>
          <p className="eyebrow">InterAct Session Report</p>
          <h1><BookOpen size={28} />課堂互動報告</h1>
          <p className="muted">{reportData.session.title}．{new Date(reportData.session.created_at).toLocaleString('zh-TW')}</p>
        </div>
        <div className="report-actions">
          <button className="ghost-button" type="button" onClick={() => void returnToSessionManager()}>
            <ArrowLeft size={17} />返回場次管理
          </button>
          <button type="button" onClick={exportExcel} disabled={exporting}>
            {exporting ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            {exporting ? '匯出中...' : '匯出 Excel'}
          </button>
        </div>
      </header>

      {error && <p className="report-inline-error error">{error}</p>}

      <section className="report-metrics" aria-label="課堂互動統計">
        <article><Users size={20} /><span>參與者</span><strong>{metrics.participant_count}</strong></article>
        <article><MessageSquareText size={20} /><span>彈幕次數</span><strong>{metrics.message_count}</strong></article>
        <article><ListChecks size={20} /><span>題目／作答</span><strong>{metrics.question_count}／{metrics.answer_count}</strong></article>
        <article><ChartNoAxesCombined size={20} /><span>平均作答率</span><strong>{formatPercent(metrics.average_response_rate)}</strong></article>
        <article><Clock size={20} /><span>課堂長度</span><strong>{metrics.duration_minutes} 分</strong></article>
      </section>

      <section className="report-section report-summary-band">
        <div className="report-section-heading">
          <h2>AI 課堂總結</h2>
          <span className={`engagement-badge ${analysis.engagement_analysis.level}`}>
            互動程度：{analysis.engagement_analysis.level === 'high' ? '高' : analysis.engagement_analysis.level === 'medium' ? '中' : '低'}
          </span>
        </div>
        <p className="report-lead">{analysis.executive_summary}</p>
        <p>{analysis.engagement_analysis.summary}</p>
      </section>

      {analysis.lesson_key_points?.length ? (
        <section className="report-section report-summary-band">
          <div className="report-section-heading">
            <BookOpen size={20} />
            <h2>課堂重點整理</h2>
          </div>
          <ul>
            {analysis.lesson_key_points.map((point) => <li key={point}>{point}</li>)}
          </ul>
        </section>
      ) : null}

      <section className="report-section">
        <h2>課堂文字與連結派送</h2>
        {reportData.sharedContents.length ? (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>派送時間</th><th>文字內容</th><th>連結</th></tr></thead>
              <tbody>
                {reportData.sharedContents.map((content) => (
                  <tr key={content.id}>
                    <td>{new Date(content.created_at).toLocaleString('zh-TW')}</td>
                    <td>{content.body || '—'}</td>
                    <td>
                      {content.url
                        ? <a href={content.url} rel="noreferrer" target="_blank">{content.url}</a>
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">本場次沒有派送文字或連結。</p>}
      </section>

      <section className="report-section">
        <h2>錄音評測</h2>
        {reportData.audioResponses.length ? (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>題次／題型</th><th>姓名</th><th>語言／分數</th><th>AI 分析</th><th>優點</th><th>改善建議</th></tr></thead>
              <tbody>
                {reportData.audioResponses.map((response) => {
                  const item = response.analysis_json
                  const meta = questionMeta.get(response.question_id)
                  return (
                    <tr key={response.id}>
                      <td>{meta ? `${meta.number}．${meta.type}` : '—'}</td>
                      <td>{response.participant_name}</td>
                      <td>{response.detected_language || '—'}<br />{typeof response.score === 'number' ? `${response.score} 分` : '分析未完成'}</td>
                      <td>{item?.summary || response.error_message || '—'}</td>
                      <td>{item?.strengths.join('、') || '—'}</td>
                      <td>{item?.improvements.join('、') || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">本場次沒有錄音評測。</p>}
      </section>

      <div className="report-two-column">
        <section className="report-section">
          <h2>互動觀察</h2>
          <h3>參與情形</h3>
          <BulletList items={analysis.engagement_analysis.participation_observations} />
          <h3>彈幕內容</h3>
          <BulletList items={analysis.engagement_analysis.danmaku_observations} />
        </section>
        <section className="report-section">
          <h2>學習理解</h2>
          <p>{analysis.learning_analysis.overall_understanding}</p>
          <h3>學習優勢</h3>
          <BulletList items={analysis.learning_analysis.strengths} />
          <h3>常見迷思</h3>
          <BulletList items={analysis.learning_analysis.misconceptions} />
        </section>
      </div>

      <section className="report-section">
        <h2>問題分析</h2>
        {analysis.learning_analysis.question_findings.length ? (
          <div className="report-table-wrap">
            <table className="report-table">
              <thead><tr><th>題型</th><th>題次</th><th>題目</th><th>結果</th><th>資料證據</th></tr></thead>
              <tbody>
                {analysis.learning_analysis.question_findings.map((finding) => (
                  <tr key={finding.question_id}>
                    <td>{questionMeta.get(finding.question_id)?.type || '—'}</td>
                    <td>{questionMeta.get(finding.question_id)?.number || '—'}</td>
                    <td>{finding.detected_question}</td>
                    <td>{finding.result_summary}</td>
                    <td>{finding.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="muted">這個場次沒有可分析的題目。</p>}
      </section>

      <div className="report-two-column">
        <section className="report-section">
          <h2>教學建議</h2>
          <h3>立即可做</h3>
          <BulletList items={analysis.teaching_recommendations.immediate_actions} />
          <h3>下節課調整</h3>
          <BulletList items={analysis.teaching_recommendations.next_lesson_actions} />
        </section>
        <section className="report-section">
          <h2>追問題目</h2>
          <BulletList items={analysis.teaching_recommendations.follow_up_questions} />
          <h3>分析限制</h3>
          <BulletList items={analysis.limitations} />
        </section>
      </div>
    </main>
  )
}
