export type AssignmentProgress = {
  questionId: string
  status: string
  type: string
  round: number
  expectedIds: string[]
  submittedIds: string[]
}
export function pendingAssignment(progress: AssignmentProgress | null) {
  if (!progress || ['send_screen', 'board', 'camera_poll'].includes(progress.type)) return null
  const submitted = new Set(progress.submittedIds)
  const expected = [...new Set(progress.expectedIds)]
  return { pending: expected.filter(id => !submitted.has(id)), total: expected.length,
    closed: progress.status !== 'active', questionId: progress.questionId }
}
