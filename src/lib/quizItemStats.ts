import type { PresenterQuizResults } from '../types'

export function quizItemStats(results: PresenterQuizResults, itemId: string) {
  const item = results.items.find(entry => entry.id === itemId)
  const answers = new Map(results.answers.filter(answer => answer.item_id === itemId).map(answer => [answer.attempt_id, answer]))
  const wrong: Array<{ id: string; name: string; anonymousName: string }> = []
  let correct = 0, pending = 0, missing = 0
  for (const [index, attempt] of results.attempts.entries()) {
    const answer = answers.get(attempt.id)
    if (!answer) { missing++; continue }
    if (attempt.status !== 'graded' || answer.score === null || !Number.isFinite(answer.score) || !item) { pending++; continue }
    if (answer.score >= item.points) correct++
    else wrong.push({ id: attempt.participant_id, name: attempt.participant_name, anonymousName: `匿名學員 ${index + 1}` })
  }
  return { submitted: results.attempts.length, correct, wrong, pending, missing }
}
