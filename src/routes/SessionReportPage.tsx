import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, ChartNoAxesCombined, Clock, Download, ListChecks, LoaderCircle, MessageSquareText, RefreshCw, Users, X } from 'lucide-react'
import { getPresenterToken } from '../lib/presenterAuth'
import { requireSupabase } from '../lib/supabase'
import type { AiSummary, Answer, ExitTicket, Message, Participant, Question, Screenshot, Session, SessionAnalysis, SessionMetrics, SessionReportData } from '../types'
import { useParams } from 'react-router-dom'

const PAGE_SIZE = 1000

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
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null)
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null)
  const [reportData, setReportData] = useState<SessionReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const loadReportData = useCallback(async () => {
    const supabase = requireSupabase()
    const { data: session, error: sessionError } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
    if (sessionError) throw sessionError

    const [participants, messages, screenshots, questions, answers, aiSummaries, exitTickets] = await Promise.all([
      fetchAllRows<Participant>('participants', sessionId, 'joined_at'),
      fetchAllRows<Message>('messages', sessionId, 'created_at'),
      fetchAllRows<Screenshot>('screenshots', sessionId, 'created_at'),
      fetchAllRows<Question>('questions', sessionId, 'created_at'),
      fetchAllRows<Answer>('answers', sessionId, 'submitted_at'),
      fetchAllRows<AiSummary>('ai_summaries', sessionId, 'created_at'),
      fetchAllRows<ExitTicket>('exit_tickets', sessionId, 'submitted_at'),
    ])

    setReportData({
      session: session as Session,
      participants,
      messages,
      screenshots,
      questions,
      answers,
      aiSummaries,
      exitTickets,
    })
  }, [sessionId])

  const generateReport = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const presenterToken = getPresenterToken(sessionId)
      if (!presenterToken) throw new Error('找不到這個場次的講者權限，無法產生課堂報告。')

      const { data, error: functionError } = await requireSupabase().functions.invoke('analyze-session', {
        body: { sessionId, presenterToken },
      })
      if (functionError) throw new Error(await edgeFunctionMessage(functionError))
      if (!data?.analysis || !data?.metrics) throw new Error(data?.message || 'Gemini 沒有回傳完整課堂分析。')

      setAnalysis(data.analysis as SessionAnalysis)
      setMetrics(data.metrics as SessionMetrics)
      await loadReportData()
    } catch (caught) {
      setError(await edgeFunctionMessage(caught))
    } finally {
      setLoading(false)
    }
  }, [loadReportData, sessionId])

  useEffect(() => {
    generateReport()
  }, [generateReport])

  const questionNumber = useMemo(
    () => new Map((reportData?.questions || []).map((question, index) => [question.id, index + 1])),
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

  function closeAll() {
    if (window.interactDesktop) {
      window.interactDesktop.close()
    } else {
      window.close()
    }
  }

  if (loading) {
    return (
      <main className="session-report-page report-loading">
        <LoaderCircle className="spin" size={34} />
        <h1>Gemini 正在分析整節課</h1>
        <p className="muted">彙整題目、作答、彈幕與參與資料...</p>
      </main>
    )
  }

  if (error && (!analysis || !metrics || !reportData)) {
    return (
      <main className="session-report-page report-loading">
        <h1>報告尚未產生</h1>
        <p className="error">{error}</p>
        <div className="report-actions">
          <button type="button" onClick={generateReport}><RefreshCw size={17} />重新分析</button>
          <button className="ghost-button" type="button" onClick={closeAll}><X size={17} />關閉並結束</button>
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
          <button type="button" onClick={exportExcel} disabled={exporting}>
            {exporting ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}
            {exporting ? '匯出中...' : '匯出 Excel'}
          </button>
          <button className="ghost-button" type="button" onClick={closeAll}><X size={17} />關閉並結束</button>
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
          <h2>Gemini 課堂總結</h2>
          <span className={`engagement-badge ${analysis.engagement_analysis.level}`}>
            互動程度：{analysis.engagement_analysis.level === 'high' ? '高' : analysis.engagement_analysis.level === 'medium' ? '中' : '低'}
          </span>
        </div>
        <p className="report-lead">{analysis.executive_summary}</p>
        <p>{analysis.engagement_analysis.summary}</p>
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
              <thead><tr><th>題次</th><th>題目</th><th>結果</th><th>資料證據</th></tr></thead>
              <tbody>
                {analysis.learning_analysis.question_findings.map((finding) => (
                  <tr key={finding.question_id}>
                    <td>{questionNumber.get(finding.question_id) || '—'}</td>
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
