import { CheckCircle2, Sparkles } from 'lucide-react'
import { correctnessStats, countByAnswer } from '../lib/stats'
import type { Answer, Question, QuestionAnalysis } from '../types'

type Props = {
  question: Question | null
  answers: Answer[]
  analysis: QuestionAnalysis | null
  analysisBusy: boolean
  analysisError: string
  onAnalyze: () => void
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

function AiAnalysisPanel({ question, answers, analysis, analysisBusy, analysisError, onAnalyze, onSetCorrectAnswer }: AnalysisProps) {
  if (!question || question.type === 'send_screen') return null

  const canAnalyze = question.status !== 'active' && answers.length > 0
  const suggestion = analysis?.question_understanding.suggested_correct_answer
  const canApplySuggestion = Boolean(
    suggestion
    && (question.type === 'multiple_choice' || question.type === 'true_false')
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
  const { question, answers, onSetCorrectAnswer } = props

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
            <span className={`status ${question.status}`}>{question.status}</span>
          </div>
          <p className="muted">已作答 {answers.length} 人</p>
          <div className="answer-list">
            {answers.map((answer) => (
              <article className="answer-item" key={answer.id}>
                <strong>{answer.participant_name}</strong>
                <p>{answer.answer_text}</p>
              </article>
            ))}
          </div>
        </section>
        <AiAnalysisPanel {...props} />
      </>
    )
  }

  const counts = countByAnswer(answers)
  const correctness = correctnessStats(question, answers)

  return (
    <>
      <section className="panel result-panel">
        <div className="panel-heading">
          <h2>{question.title}</h2>
          <span className={`status ${question.status}`}>{question.status}</span>
        </div>
        <p className="muted">已作答 {answers.length} 人</p>
        <div className="option-results">
          {question.options.map((option) => {
            const count = counts[option] || 0
            const rate = answers.length ? Math.round((count / answers.length) * 100) : 0
            const canSetCorrectAnswer = question.type === 'multiple_choice' || question.type === 'true_false'

            return (
              <div className="bar-row" key={option}>
                <button
                  className={question.correct_answer === option ? 'correct-option' : 'ghost-button'}
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
            {question.type === 'poll' ? '投票題不需要正確答案。' : '點選正確選項後即可計算答對比例。'}
          </p>
        )}
      </section>
      <AiAnalysisPanel {...props} />
    </>
  )
}
