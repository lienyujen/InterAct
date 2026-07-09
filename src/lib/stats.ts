import type { Answer, Question } from '../types'

export function countByAnswer(answers: Answer[]) {
  return answers.reduce<Record<string, number>>((acc, answer) => {
    const key = answer.answer_value || answer.answer_text || '未填答'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})
}

export function correctnessStats(question: Question | null, answers: Answer[]) {
  if (!question?.correct_answer) return null

  const correct = answers.filter((answer) => answer.answer_value === question.correct_answer).length
  const total = answers.length
  const incorrect = Math.max(total - correct, 0)

  return {
    correct,
    incorrect,
    total,
    correctRate: total ? Math.round((correct / total) * 100) : 0,
    incorrectRate: total ? Math.round((incorrect / total) * 100) : 0,
  }
}
