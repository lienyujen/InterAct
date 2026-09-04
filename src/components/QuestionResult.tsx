import { AudioLines, CheckCircle2, Dice5, Download, FileUp, LoaderCircle, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { correctnessStats, countByAnswer } from '../lib/stats'
import { downloadHref } from '../lib/fileLinks'
import type { Answer, AudioResponse, FileResponse, Question, QuestionAnalysis } from '../types'

type Props = {
  anonymousEnabled: boolean
  question: Question | null
  answers: Answer[]
  audioResponses: AudioResponse[]
  fileResponses: FileResponse[]
  // Which upload is being marked right now, and how far a mark-everything run has got.
  fileBusyId: string
  gradeProgress: { done: number; total: number } | null
  analysis: QuestionAnalysis | null
  analysisBusy: boolean
  analysisError: string
  busy: boolean
  isCurrentQuestion: boolean
  onlineCount: number
  onAnalyze: () => void
  onAnalyzeFile: (responseId: string) => void
  onDrawUnanswered: (questionId: string) => void
  onSetCorrectAnswer: (answer: string) => void
}

type AnalysisProps = Pick<Props,
  'question' | 'answers' | 'analysis' | 'analysisBusy' | 'analysisError' | 'onAnalyze' | 'onSetCorrectAnswer'
  | 'fileResponses' | 'gradeProgress'>

function ItemList({ items }: { items: string[] }) {
  if (!items.length) return <p className="muted">目前沒有可列出的項目。</p>
  return (
    <ul className="analysis-list">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  )
}

function QuestionStatusActions({
  busy,
  isCurrentQuestion,
  onlineCount,
  onDrawUnanswered,
  question,
}: Pick<Props, 'busy' | 'isCurrentQuestion' | 'onlineCount' | 'onDrawUnanswered'> & { question: Question }) {
  const canDrawUnanswered = isCurrentQuestion
    && question.type !== 'send_screen'
    && (question.status === 'stopped' || question.status === 'closed')

  return (
    <div className="question-heading-actions">
      {canDrawUnanswered && (
        <button
          aria-label="抽選本題未作答學生"
          className="question-unanswered-draw"
          disabled={busy || !onlineCount}
          title={onlineCount ? '抽選目前線上且未作答本題的學生' : '目前沒有線上學生'}
          type="button"
          onClick={() => onDrawUnanswered(question.id)}
        >
          <Dice5 size={20} />
        </button>
      )}
      <span className={`status ${question.status}`}>{question.status}</span>
    </div>
  )
}

function AiAnalysisPanel({
  question, answers, analysis, analysisBusy, analysisError, fileResponses, gradeProgress, onAnalyze, onSetCorrectAnswer,
}: AnalysisProps) {
  if (!question || ['send_screen', 'pronunciation', 'oral_response'].includes(question.type)) return null

  const isUpload = question.type === 'file_upload'
  // Counted in students, because that is what a press costs: one call covers
  // every page one student sent.
  const unmarked = isUpload
    ? new Set(fileResponses
      .filter((response) => ['pending', 'failed'].includes(response.analysis_status))
      .map((response) => response.participant_id)).size
    : 0
  const canAnalyze = question.status !== 'active'
    && (isUpload ? fileResponses.length > 0 : answers.length > 0)
  const suggestion = analysis?.question_understanding.suggested_correct_answer
  const canApplySuggestion = Boolean(
    suggestion
    && (question.type === 'multiple_choice' || question.type === 'true_false')
    && !question.allow_multiple
    && question.options.includes(suggestion),
  )

  return (
    <section className="panel ai-analysis-panel">
      <div className="panel-heading">
        <h2><Sparkles size={18} />AI 完整分析</h2>
        <button disabled={!canAnalyze || analysisBusy} type="button" onClick={onAnalyze}>
          <Sparkles size={16} />
          {analysisBusy
            ? gradeProgress ? `批改中 ${gradeProgress.done}/${gradeProgress.total}...` : '分析中...'
            : isUpload
              ? unmarked ? `批改剩下 ${unmarked} 人並分析` : analysis ? '重新分析' : '分析全班'
              : analysis ? '重新分析' : 'AI 分析'}
        </button>
      </div>
      {!canAnalyze && (
        <p className="muted">停止作答且至少收到一份答案後，即可手動執行分析。</p>
      )}
      {canAnalyze && isUpload && (
        // Marking is the expensive half, so say plainly what this button will and
        // will not spend: work already paid for is never redone.
        <p className="muted">
          {unmarked
            ? `會先批改尚未批改的 ${unmarked} 人，已批改過的不再重算，再彙整全班表現。`
            : '每個人都批改過了，這一步只讀批改結果彙整全班表現。'}
        </p>
      )}
      {analysisError && <p className="error">{analysisError}</p>}
      {analysis && (
        <div className="analysis-content">
          <section>
            <h3>題目判讀</h3>
            <p>{analysis.question_understanding.detected_question}</p>
            <p className="muted">
              {analysis.question_understanding.subject} · {analysis.question_understanding.concepts.join('、')}
            </p>
            {suggestion && (
              <div className="ai-suggestion">
                <span>AI 建議答案：<strong>{suggestion}</strong></span>
                <span>信心：{analysis.question_understanding.confidence}</span>
                {canApplySuggestion && (
                  <button className="ghost-button" type="button" onClick={() => onSetCorrectAnswer(suggestion)}>
                    <CheckCircle2 size={16} />採用為正確答案
                  </button>
                )}
              </div>
            )}
            <p>{analysis.question_understanding.reasoning}</p>
          </section>

          <details open>
            <summary>作答理解</summary>
            <p>{analysis.response_analysis.understanding_summary}</p>
            <p className="muted">
              作答 {analysis.response_analysis.response_count} 人 · 回覆率 {analysis.response_analysis.response_rate}%
            </p>
            <h4>已掌握</h4>
            <ItemList items={analysis.response_analysis.strengths} />
            <h4>可能誤解</h4>
            <ItemList items={analysis.response_analysis.misconceptions} />
            <h4>代表性作答模式</h4>
            <ItemList items={analysis.response_analysis.representative_patterns} />
          </details>

          <details open>
            <summary>教學建議</summary>
            <h4>立即處理</h4>
            <ItemList items={analysis.teaching_recommendations.immediate_actions} />
            <h4>講解重點</h4>
            <ItemList items={analysis.teaching_recommendations.explanation_points} />
            <h4>追問題目</h4>
            <ItemList items={analysis.teaching_recommendations.follow_up_questions} />
          </details>

          {analysis.limitations.length > 0 && (
            <details>
              <summary>分析限制</summary>
              <ItemList items={analysis.limitations} />
            </details>
          )}
        </div>
      )}
    </section>
  )
}

const verdictLabels: Record<string, string> = {
  correct: '正確',
  partial: '部分正確',
  incorrect: '不正確',
  unscored: '未評分',
}

const uploadStatusLabels: Record<FileResponse['analysis_status'], string> = {
  pending: '尚未批改',
  analyzing: '批改中...',
  success: '已批改',
  failed: '批改失敗',
  unsupported: 'AI 無法讀取此格式',
}

function isImageFile(mimeType: string, name: string) {
  return mimeType.startsWith('image/') || /.(png|jpe?g|webp|gif|heic|heif)$/i.test(name)
}

// One row per student, not per file: an essay photographed as three pages is
// one answer, and the marker treats it that way too.
function UploadResults({
  anonymousEnabled, fileBusyId, fileResponses, question, onAnalyzeFile,
}: Pick<Props, 'anonymousEnabled' | 'fileBusyId' | 'fileResponses' | 'onAnalyzeFile'> & { question: Question }) {
  const [expanded, setExpanded] = useState('')

  const submissions = useMemo(() => {
    const groups = new Map<string, FileResponse[]>()
    for (const response of fileResponses) {
      const existing = groups.get(response.participant_id)
      if (existing) existing.push(response)
      else groups.set(response.participant_id, [response])
    }
    // A student's own files are ordered so the one carrying the mark leads:
    // a stray .docx first would otherwise present the whole submission as
    // unreadable and hide the button that would have marked their photo.
    const rank = (response: FileResponse) => response.analysis_status === 'success' ? 0
      : response.analysis_status === 'unsupported' ? 2 : 1
    return [...groups.values()].map((files) => [...files].sort((left, right) => rank(left) - rank(right)))
  }, [fileResponses])

  const marked = submissions.filter((files) => files[0].analysis_status === 'success').length

  if (!submissions.length) {
    return (
      <p className="muted">
        {question.status === 'active' ? '還沒有學生上傳作答。' : '這一題沒有收到任何上傳。'}
      </p>
    )
  }

  return (
    <>
      <p className="muted">已上傳 {submissions.length} 人 · 已批改 {marked} 人</p>
      <ul className="file-list upload-answer-list">
        {submissions.map((files, index) => {
          const lead = files[0]
          const result = lead.analysis_json
          const verdict = result?.verdict || ''
          const busy = files.some((file) => fileBusyId === file.id || file.analysis_status === 'analyzing')
          const preview = files.find((file) => isImageFile(file.mime_type, file.name) && file.file_url)
          const failure = files.find((file) => file.error_message && file.analysis_status !== 'success')
          return (
            <li key={lead.participant_id}>
              <div className="file-response-row">
                {preview ? (
                  <a href={preview.file_url} rel="noreferrer" target="_blank">
                    <img alt={preview.name} className="file-response-thumb" src={preview.file_url} />
                  </a>
                ) : <span className="file-response-thumb is-placeholder"><FileUp size={18} /></span>}
                <div className="file-list-meta">
                  <strong>{anonymousEnabled ? `匿名作答 ${index + 1}` : lead.participant_name}</strong>
                  <span className="muted">
                    {files.map((file) => file.name).join('、')}
                    {files.length > 1 && ` · ${files.length} 個檔案`}
                  </span>
                  <span className="upload-verdict-line">
                    {verdict && <span className={`file-verdict is-${verdict}`}>{verdictLabels[verdict] || verdict}</span>}
                    {typeof result?.score === 'number' && <span className="upload-score">{result.score} 分</span>}
                    {!verdict && (
                      <span className={`file-analysis-status is-${lead.analysis_status}`}>
                        {uploadStatusLabels[lead.analysis_status]}
                      </span>
                    )}
                  </span>
                </div>
                <div className="file-list-actions">
                  {files.filter((file) => file.file_url).map((file, fileIndex) => (
                    <a
                      className="ghost-button"
                      href={downloadHref(file.file_url as string, file.name)}
                      key={file.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Download size={15} />下載{files.length > 1 ? ` ${fileIndex + 1}` : ''}
                    </a>
                  ))}
                  {lead.analysis_status !== 'unsupported' && (
                    <button disabled={busy} type="button" onClick={() => onAnalyzeFile(lead.id)}>
                      {busy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
                      {lead.analysis_status === 'success' ? '重批' : 'AI 批改'}
                    </button>
                  )}
                  {lead.analysis_status === 'success' && (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setExpanded(expanded === lead.participant_id ? '' : lead.participant_id)}
                    >
                      {expanded === lead.participant_id ? '收合' : '看批改'}
                    </button>
                  )}
                </div>
              </div>
              {failure && <p className="muted file-analysis-error">{failure.error_message}</p>}
              {expanded === lead.participant_id && result && (
                <div className="file-analysis-detail">
                  <p>{result.summary_zh_tw}</p>
                  {result.strengths_zh_tw.length > 0 && (
                    <>
                      <h4>做得好</h4>
                      <ul>{result.strengths_zh_tw.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                    </>
                  )}
                  {result.improvements_zh_tw.length > 0 && (
                    <>
                      <h4>可改進</h4>
                      <ul>{result.improvements_zh_tw.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function QuestionResult(props: Props) {
  const { anonymousEnabled, question, answers, audioResponses, analysis, onSetCorrectAnswer } = props

  if (!question) {
    return (
      <section className="panel">
        <h2>目前沒有題目</h2>
        <p className="muted">截圖派題後，作答狀態會顯示在這裡。</p>
      </section>
    )
  }

  if (question.type === 'send_screen') {
    return (
      <section className="panel result-panel">
        <div className="panel-heading">
          <h2>派送畫面</h2>
          <span className={`status ${question.status}`}>{question.status}</span>
        </div>
        <p className="muted">目前派送的是畫面，不需要作答。</p>
      </section>
    )
  }

  if (question.type === 'short_answer') {
    return (
      <>
        <section className="panel result-panel">
          <div className="panel-heading">
            <h2>問答題</h2>
            <QuestionStatusActions {...props} question={question} />
          </div>
          <p className="muted">已作答 {answers.length} 人</p>
          <div className="answer-list">
            {answers.map((answer, index) => (
              <article className="answer-item" key={answer.id}>
                <strong>{anonymousEnabled ? `匿名回答 ${index + 1}` : answer.participant_name}</strong>
                <p>{answer.answer_text}</p>
              </article>
            ))}
          </div>
        </section>
        <AiAnalysisPanel {...props} />
      </>
    )
  }

  if (question.type === 'file_upload') {
    return (
      <>
        <section className="panel result-panel upload-results-panel">
          <div className="panel-heading">
            <h2><FileUp size={20} />{question.title}</h2>
            <QuestionStatusActions {...props} question={question} />
          </div>
          {question.prompt_text && <p className="detected-question">{question.prompt_text}</p>}
          <UploadResults
            anonymousEnabled={anonymousEnabled}
            fileBusyId={props.fileBusyId}
            fileResponses={props.fileResponses}
            question={question}
            onAnalyzeFile={props.onAnalyzeFile}
          />
        </section>
        <AiAnalysisPanel {...props} />
      </>
    )
  }

  if (question.type === 'pronunciation' || question.type === 'oral_response') {
    return (
      <section className="panel result-panel audio-results-panel">
        <div className="panel-heading">
          <h2><AudioLines size={20} />{question.title}</h2>
          <QuestionStatusActions {...props} question={question} />
        </div>
        {question.prompt_text && <p className="detected-question">{question.prompt_text}</p>}
        <p className="muted">已錄音 {answers.length} 人</p>
        {question.status === 'active' ? (
          <p className="muted">停止作答後會顯示個別 AI 評測與錄音播放器。</p>
        ) : audioResponses.length ? (
          <div className="audio-result-list">
            {audioResponses.map((response, index) => {
              const result = response.analysis_json
              return (
                <article className="audio-result-item" key={response.id}>
                  <div className="audio-result-heading">
                    <strong>{anonymousEnabled ? `匿名回答 ${index + 1}` : response.participant_name}</strong>
                    {typeof response.score === 'number' && <span className="audio-result-score">{response.score} 分</span>}
                  </div>
                  {response.signed_url && <audio controls preload="metadata" src={response.signed_url} />}
                  {response.analysis_status === 'success' && result ? (
                    <>
                      <p className="audio-feedback-summary">{result.summary}</p>
                      <div className="audio-analysis-grid">
                        <div><strong>內容對照</strong><p>{result.relevance}</p></div>
                        <div><strong>表達清晰度</strong><p>{result.clarity}</p></div>
                        <div><strong>完成度</strong><p>{result.completeness}</p></div>
                      </div>
                      <div className="audio-feedback-section"><strong>做得好的地方</strong><ul>{result.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      <div className="audio-feedback-section"><strong>改善建議</strong><ul>{result.improvements.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      <details><summary>查看辨識內容</summary><p>{result.transcript || '未辨識到語音內容'}</p></details>
                    </>
                  ) : response.analysis_status === 'failed' ? (
                    <p className="error">AI 評測失敗，錄音仍可播放。</p>
                  ) : (
                    <p className="muted">AI 評測仍在處理中。</p>
                  )}
                </article>
              )
            })}
          </div>
        ) : (
          <p className="muted">目前沒有錄音作答。</p>
        )}
      </section>
    )
  }

  const counts = countByAnswer(answers)
  const correctness = correctnessStats(question, answers)
  const correctAnswers = question.correct_answers?.length
    ? question.correct_answers
    : question.correct_answer
      ? [question.correct_answer]
      : []

  return (
    <>
      <section className="panel result-panel">
        <div className="panel-heading">
          <h2>{question.title}</h2>
          <QuestionStatusActions {...props} question={question} />
        </div>
        {(analysis?.question_understanding.detected_question || question.prompt_text) && (
          <p className="detected-question">{analysis?.question_understanding.detected_question || question.prompt_text}</p>
        )}
        <p className="muted">已作答 {answers.length} 人</p>
        <div className="option-results">
          {question.options.map((option) => {
            const count = counts[option] || 0
            const rate = answers.length ? Math.round((count / answers.length) * 100) : 0
            const canSetCorrectAnswer = question.status !== 'active'
              && (question.type === 'multiple_choice' || question.type === 'true_false')

            return (
              <div className="bar-row" key={option}>
                <button
                  className={correctAnswers.includes(option) ? 'correct-option' : 'ghost-button'}
                  disabled={!canSetCorrectAnswer}
                  type="button"
                  onClick={() => onSetCorrectAnswer(option)}
                >
                  {option}
                </button>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${rate}%` }} />
                </div>
                <span>{count} / {rate}%</span>
              </div>
            )
          })}
        </div>
        {correctness ? (
          <div className="correctness">
            <strong>答對 {correctness.correctRate}%</strong>
            <span>答錯 {correctness.incorrectRate}%</span>
          </div>
        ) : (
          <p className="muted">
            {question.type === 'poll'
              ? '投票題不需要正確答案。'
              : question.status === 'active'
                ? '停止作答後可設定正確答案。'
                : question.allow_multiple
                  ? '可點選一個或多個正確選項，再計算答對比例。'
                  : '點選正確選項後即可計算答對比例。'}
          </p>
        )}
      </section>
      <AiAnalysisPanel {...props} />
    </>
  )
}
