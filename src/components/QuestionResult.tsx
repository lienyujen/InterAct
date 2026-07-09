import type { Answer, Question } from '../types'
import { correctnessStats, countByAnswer } from '../lib/stats'

type Props = {
  question: Question | null
  answers: Answer[]
  onSetCorrectAnswer: (answer: string) => void
}

export function QuestionResult({ question, answers, onSetCorrectAnswer }: Props) {
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
    )
  }

  const counts = countByAnswer(answers)
  const correctness = correctnessStats(question, answers)

  return (
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
              <span>
                {count} / {rate}%
              </span>
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
        <p className="muted">{question.type === 'poll' ? '投票題不需要正確答案。' : '停止作答後，點選正確選項即可計算答對比例。'}</p>
      )}
    </section>
  )
}
