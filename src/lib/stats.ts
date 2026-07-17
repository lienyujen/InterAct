import type { Answer, Question } from '../types'

export function countByAnswer(answers: Answer[]) {
  return answers.reduce<Record<string, number>>((acc, answer) => {
    const values = answer.answer_values?.length
      ? answer.answer_values
      : [answer.answer_value || answer.answer_text || '未填答']
    values.forEach((key) => {
      acc[key] = (acc[key] || 0) + 1
    })
    return acc
  }, {})
}

export function correctnessStats(question: Question | null, answers: Answer[]) {
  const correctAnswers = question?.correct_answers?.length
    ? question.correct_answers
    : question?.correct_answer
      ? [question.correct_answer]
      : []
  if (!correctAnswers.length) return null

  const expected = [...new Set(correctAnswers)].sort()
  const correct = answers.filter((answer) => {
    const submitted = [...new Set(answer.answer_values?.length ? answer.answer_values : answer.answer_value ? [answer.answer_value] : [])].sort()
    return submitted.length === expected.length && submitted.every((value, index) => value === expected[index])
  }).length
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
