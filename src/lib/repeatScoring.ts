import type { Question } from '../types'

// New submission replaces this learner's previous attempt, not everybody's.
// Preserve old rounds for reports, but never award participation twice.
export function repeatScoring(questions: Question[]) {
  const byId = new Map(questions.map(q => [q.id, q]))
  const root = (id: string) => byId.get(id)?.repeat_root_id || id
  function latest<T extends { question_id: string; participant_id: string; submitted_at: string; round?: number }>(rows: T[]) {
    const seen = new Map<string, T>()
    for (const row of rows) {
      const key = `${root(row.question_id)}:${row.participant_id}`
      const old = seen.get(key)
      const rank = (r: T) => `${String(byId.get(r.question_id)?.repeat_number || 1).padStart(6, '0')}:${byId.get(r.question_id)?.created_at || ''}:${String(r.round || 1).padStart(6, '0')}:${r.submitted_at}`
      if (!old || rank(row) > rank(old)) seen.set(key, row)
    }
    return rows.filter(row => {
      const chosen = seen.get(`${root(row.question_id)}:${row.participant_id}`)
      return chosen?.question_id === row.question_id && (chosen.round || 1) === (row.round || 1)
    }).map(row => ({ ...row, question_id: root(row.question_id) }))
  }
  const grouped = new Map<string, Question>()
  for (const q of questions) grouped.set(root(q.id), { ...q, id: root(q.id) })
  return { root, latest, questions: [...grouped.values()] }
}
