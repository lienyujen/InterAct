import { Play, Square } from 'lucide-react'
import { useState } from 'react'
import type { Question } from '../types'

type Props = {
  question: Question
  // Only the question the class is on can be stopped or reopened; an older one
  // in the history is a record, not a control.
  isCurrentQuestion: boolean
  busy: boolean
  onStop: () => Promise<void>
  onResume: () => Promise<void>
}

// One button that changes its mind rather than two that each go one way. The
// title says the stop is reversible, because a teacher who does not know that
// will not press it in the middle of an activity.
export function QuestionStopControl({ question, isCurrentQuestion, busy, onStop, onResume }: Props) {
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState('')

  const stoppable = isCurrentQuestion && question.status === 'active'
  const resumable = isCurrentQuestion && question.status === 'stopped'
  if (!stoppable && !resumable) return null

  async function run(action: () => Promise<void>) {
    setToggling(true)
    setError('')
    try {
      await action()
    } catch (caught) {
      // Shown on the control the presenter actually pressed, rather than in a
      // panel somewhere else on the screen.
      setError(caught instanceof Error ? caught.message : '操作失敗。')
    } finally {
      setToggling(false)
    }
  }

  return (
    <span className="question-stop-control">
      <button
        className={`question-stop-button${resumable ? ' is-resume' : ''}`}
        disabled={busy || toggling}
        title={resumable ? '讓學生可以再次作答' : '停止收答，之後仍可恢復'}
        type="button"
        onClick={() => void run(resumable ? onResume : onStop)}
      >
        {resumable ? <Play size={15} /> : <Square size={15} />}
        {resumable ? '恢復作答' : '停止作答'}
      </button>
      {error && <span className="error question-stop-error">{error}</span>}
    </span>
  )
}
