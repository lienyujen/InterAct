import type { QuizRequestedType } from '../types'

type Props = {
  count: string
  direction: string
  quizType: QuizRequestedType
  onCountChange: (value: string) => void
  onDirectionChange: (value: string) => void
  onTypeChange: (value: QuizRequestedType) => void
}

// Shared by the screenshot editor and the shared-file dialog so the two offer
// exactly the same choices; a quiz built from a file is the same quiz.
export function CustomQuizFields({
  count,
  direction,
  quizType,
  onCountChange,
  onDirectionChange,
  onTypeChange,
}: Props) {
  return (
    <div className="custom-quiz-editor">
      <div className="custom-quiz-settings-row">
        <label>
          題數
          <select value={count} onChange={(event) => onCountChange(event.target.value)}>
            <option value="auto">自動判斷</option>
            {Array.from({ length: 10 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>{value} 題</option>
            ))}
          </select>
        </label>
        <label>
          題型
          <select value={quizType} onChange={(event) => onTypeChange(event.target.value as QuizRequestedType)}>
            <option value="random">隨機／AI自動判斷</option>
            <option value="multiple_choice">選擇題</option>
            <option value="fill_blank">填充題</option>
            <option value="short_answer">簡答題</option>
          </select>
        </label>
      </div>
      <label className="question-prompt-field">
        出題方向
        <textarea
          maxLength={2000}
          required
          rows={4}
          value={direction}
          placeholder="請說明測驗對象、欲測能力與題目難度"
          onChange={(event) => onDirectionChange(event.target.value)}
        />
      </label>
      <p className="muted custom-quiz-hint">也可以直接在出題方向指定題數與題型；題數選「自動判斷」、題型選「隨機」即可。</p>
    </div>
  )
}
