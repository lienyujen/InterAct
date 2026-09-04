import { AudioLines, CheckCircle2, Dice5, Sparkles } from 'lucide-react'
import { correctnessStats, countByAnswer } from '../lib/stats'
import type { Answer, AudioResponse, Question, QuestionAnalysis } from '../types'

type Props = {
  anonymousEnabled: boolean
  question: Question | null
  answers: Answer[]
  audioResponses: AudioResponse[]
  analysis: QuestionAnalysis | null
  analysisBusy: boolean
  analysisError: string
  busy: boolean
  isCurrentQuestion: boolean
  onlineCount: number
  onAnalyze: () => void
  onDrawUnanswered: (questionId: string) => void
  onSetCorrectAnswer: (answer: string) => void
}

type AnalysisProps = Pick<Props, 'question' | 'answers' | 'analysis' | 'analysisBusy' | 'analysisError' | 'onAnalyze' | 'onSetCorrectAnswer'>

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

function AiAnalysisPanel({ question, answers, analysis, analysisBusy, analysisError, onAnalyze, onSetCorrectAnswer }: AnalysisProps) {
  if (!question || ['send_screen', 'pronunciation', 'oral_response'].includes(question.type)) return null

  const canAnalyze = question.status !== 'active' && answers.length > 0
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
          {analysisBusy ? '分析中...' : analysis ? '重新分析' : 'AI 分析'}
        </button>
      </div>
      {!canAnalyze && (
        <p className="muted">停止作答且至少收到一份答案後，即可手動執行分析。</p>
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
