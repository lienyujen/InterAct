import { Play, RotateCcw, Send, Square } from 'lucide-react'
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
  onNextRound: () => Promise<void>
  // Puts an earlier question back in front of the class. Every other control
  // here needs the question to be the current one, and this is how one that is
  // not gets there.
  onRecall: () => Promise<void>
  // A second round only makes sense where the class picks from the same
  // options again; a recording or an upload is not asked twice this way.
  canRepeat: boolean
}

// One button that changes its mind rather than two that each go one way. The
// title says the stop is reversible, because a teacher who does not know that
// will not press it in the middle of an activity.
export function QuestionStopControl({ question, isCurrentQuestion, busy, canRepeat, onStop, onResume, onNextRound, onRecall }: Props) {
  const [toggling, setToggling] = useState(false)
  const [error, setError] = useState('')

  const stoppable = isCurrentQuestion && question.status === 'active'
  const resumable = isCurrentQuestion && question.status === 'stopped'
  // An older question used to be a record with no controls at all, which left
  // a class that never got to answer it with no way back — and a question left
  // 'active' behind a newer one stuck in a state nothing could reach.
  const recallable = !isCurrentQuestion
  if (!stoppable && !resumable && !recallable) return null

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

  // Icons only. These sit in the panel heading beside the question title and
  // the status badge, and three labelled buttons there wrap onto their own
  // lines and crowd out the title. The name moves into the tooltip.
  if (recallable) {
    return (
      <span className="question-stop-control">
        <button
          aria-label="重新派送"
          className="question-stop-button is-resume"
          disabled={busy || toggling}
          title="重新派送 —— 把這一題再送到學生面前。已經作答的人保留原本的作答，沒作答的可以補作答"
          type="button"
          onClick={() => void run(onRecall)}
        >
          <Send size={17} />
        </button>
        {error && <span className="error question-stop-error">{error}</span>}
      </span>
    )
  }

  return (
    <span className="question-stop-control">
      <button
        aria-label={resumable ? '恢復作答' : '停止作答'}
        className={`question-stop-button${resumable ? ' is-resume' : ''}`}
        disabled={busy || toggling}
        title={resumable ? '恢復作答 —— 讓學生可以再次作答' : '停止作答 —— 停止收答，之後仍可恢復'}
        type="button"
        onClick={() => void run(resumable ? onResume : onStop)}
      >
        {resumable ? <Play size={17} /> : <Square size={17} />}
      </button>
      {resumable && canRepeat && (
        // Reopening carries on the round that was stopped; this starts a fresh
        // one, which is what a teacher wants once the class has argued about it.
        <button
          aria-label="再做一次"
          className="question-stop-button is-repeat"
          disabled={busy || toggling}
          title="再做一次 —— 讓全班重答一次，並與上一輪對照"
          type="button"
          onClick={() => void run(onNextRound)}
        >
          <RotateCcw size={17} />
        </button>
      )}
      {error && <span className="error question-stop-error">{error}</span>}
    </span>
  )
}
