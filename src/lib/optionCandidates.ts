import type { Answer, Participant } from '../types'

export function optionCandidates(answers: Answer[], participants: Participant[], round: number, option?: string) {
  const answered = new Set(answers.filter(answer => answer.round === round
    && (option === undefined || answer.answer_value === option || answer.answer_values?.includes(option)))
    .map(answer => answer.participant_id))
  return participants.filter(participant => !participant.removed_at && (option === undefined ? !answered.has(participant.id) : answered.has(participant.id)))
    .map(participant => participant.id)
}
