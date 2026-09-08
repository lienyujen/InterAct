import { useEffect, useState } from 'react'
import type { Question, QuestionType } from '../types'

// One definition of "how long is left", shared by the student who is answering
// and the teacher who is deciding when to move on. The teacher has to see the
// clock the class is watching, or they are making that call blind.

// A screen that was only pushed out asks nothing. A quiz is paced by its own
// attempt and an upload by the upload, so neither takes a wall clock — both
// still honour stop and resume, which is what a teacher reaches for there.
const timedTypes = new Set<QuestionType>([
  'poll', 'multiple_choice', 'true_false', 'short_answer', 'pronunciation', 'oral_response',
])

// Only a spoken answer has anything to prepare: the pause before speaking is
// the exercise, which is why it is a second clock rather than part of the first.
const spokenTypes = new Set<QuestionType>(['pronunciation', 'oral_response'])

export function canBeTimed(type: QuestionType) {
  return timedTypes.has(type)
}

export function canPrepare(type: QuestionType) {
  return spokenTypes.has(type)
}

export const ANSWER_PRESETS: Array<number | null> = [null, 30, 60, 90, 180]
export const PREPARE_PRESETS: Array<number | null> = [null, 10, 20, 30]

// Said the way it is said out loud, not as a raw second count. The teacher's
// chips are always Chinese because that interface is; the student's limit
// follows whatever language they are reading the class in.
export function formatSeconds(seconds: number, locale: 'zh-TW' | 'en' = 'zh-TW') {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  if (locale === 'en') {
    if (seconds < 60) return `${seconds}s`
    return rest ? `${minutes}m ${rest}s` : `${minutes}m`
  }
  if (seconds < 60) return `${seconds}秒`
  return rest ? `${minutes}分${rest}秒` : `${minutes}分鐘`
}

// Anchored on started_at rather than on when this page happened to render the
// question: a student who reconnects halfway through has to see the time that
// is really left, and this is the same anchor the database checks against, so
// the countdown and the rule that decides are one rule rather than two that drift.
export function answerDeadline(question: Pick<Question, 'type' | 'answer_seconds' | 'started_at'>) {
  // A spoken answer's clock starts when the student chooses to begin, so there
  // is no session-wide deadline to compute; the recorder bounds it instead.
  if (spokenTypes.has(question.type)) return null
  if (!question.answer_seconds || !question.started_at) return null
  const startedAt = Date.parse(question.started_at)
  return Number.isFinite(startedAt) ? startedAt + question.answer_seconds * 1000 : null
}

// A quarter-second tick, not one second: a timer woken once a second drifts
// visibly against the clock it counts down to, and skips numbers outright once
// the tab has been throttled.
export function useSecondsLeft(deadline: number | null) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(
    () => deadline === null ? null : Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
  )

  useEffect(() => {
    if (deadline === null) {
      setSecondsLeft(null)
      return
    }
    const read = () => setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)))
    read()
    const timer = window.setInterval(read, 250)
    return () => window.clearInterval(timer)
  }, [deadline])

  return secondsLeft
}
