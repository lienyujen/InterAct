import type { Question } from '../types'

// Plain screenshots supplement the latest response activity. Never resurrect a
// stopped activity, and never let a persistent board replace the answer form.
export function screenDispatchQuestion(current: Question | null, questions: Question[]) {
  if (current?.type !== 'send_screen') return current
  return questions.filter(item => item.status === 'active'
    && !['send_screen', 'board'].includes(item.type))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || current
}

export function supportingScreenQuestion(current: Question | null, questions: Question[]) {
  return questions.filter(item => item.type === 'send_screen' && item.id !== current?.id
    && (!current || item.created_at >= current.created_at))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] || null
}
