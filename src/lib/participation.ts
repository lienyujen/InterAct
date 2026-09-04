import type { Answer, Message, Participant, Question, QuizAttempt } from '../types'

// One definition of "how involved was this student", shared by the live roster
// and the exported report so the two can never disagree.
//
// The numbers are deliberately plain arithmetic rather than a weighting anyone
// would have to take on trust: a teacher asked why someone scored 85 should be
// able to point at the rows that produced it.

export type BadgeKey = 'perfect' | 'quick' | 'accurate' | 'vocal' | 'focused'

export type Badge = {
  key: BadgeKey
  icon: string
  label: string
  detail: string
}

const BADGE_POINTS = 15

export type ParticipationRow = {
  participant: Participant
  score: number
  badges: Badge[]
  answeredQuestionIds: Set<string>
  answerCount: number
  messageCount: number
  gradedCount: number
  correctCount: number
  quickCount: number
  buzzerWins: number
  unfocusedMs: number
  focusStreakMs: number
  onlineMs: number
}

type Input = {
  participants: Participant[]
  questions: Question[]
  answers: Answer[]
  messages: Message[]
  quizAttempts: QuizAttempt[]
  // Wins from the buzzer round, which live in session_events rather than in
  // answers — being first on the buzzer is the same kind of quick as being
  // first to submit.
  buzzerWins?: Map<string, number>
}

// Questions a student could actually have answered. A screen that was only
// pushed out asks nothing, so counting it would punish everyone equally.
const answerableTypes = new Set(['poll', 'multiple_choice', 'true_false', 'short_answer', 'pronunciation', 'oral_response', 'custom_quiz', 'file_upload'])

export function answerableQuestions(questions: Question[]) {
  return questions.filter((question) => answerableTypes.has(question.type))
}

export function participationRows(input: Input): ParticipationRow[] {
  const askedIds = new Set(answerableQuestions(input.questions).map((question) => question.id))
  const askedCount = askedIds.size

  // Being among the first to answer is the part of "keen" that a raw count
  // misses, so the earliest few on each question are noted.
  const quickByParticipant = new Map<string, number>()
  const byQuestion = new Map<string, Answer[]>()
  for (const answer of input.answers) {
    if (!byQuestion.has(answer.question_id)) byQuestion.set(answer.question_id, [])
    byQuestion.get(answer.question_id)?.push(answer)
  }
  for (const list of byQuestion.values()) {
    const ordered = [...list].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
    for (const answer of ordered.slice(0, 3)) {
      quickByParticipant.set(answer.participant_id, (quickByParticipant.get(answer.participant_id) || 0) + 1)
    }
  }

  const messageCounts = new Map<string, number>()
  for (const message of input.messages) {
    messageCounts.set(message.participant_id, (messageCounts.get(message.participant_id) || 0) + 1)
  }

  const quizByParticipant = new Map<string, { score: number; max: number }>()
  for (const attempt of input.quizAttempts) {
    if (attempt.status !== 'graded' || attempt.total_score === null) continue
    const current = quizByParticipant.get(attempt.participant_id) || { score: 0, max: 0 }
    current.score += attempt.total_score
    current.max += attempt.max_score || 0
    quizByParticipant.set(attempt.participant_id, current)
  }

  return input.participants.map((participant) => {
    const own = input.answers.filter((answer) => answer.participant_id === participant.id)
    const answeredQuestionIds = new Set(own.map((answer) => answer.question_id))
    for (const attempt of input.quizAttempts) {
      if (attempt.participant_id === participant.id) answeredQuestionIds.add(attempt.question_id)
    }
    const gradedCount = own.filter((answer) => answer.is_correct !== null).length
    const correctCount = own.filter((answer) => answer.is_correct === true).length
    const messageCount = messageCounts.get(participant.id) || 0
    const quickCount = quickByParticipant.get(participant.id) || 0
    const buzzerWins = input.buzzerWins?.get(participant.id) || 0
    const unfocusedMs = participant.unfocused_ms || 0
    // The longest unbroken stretch with the page in front of them; leaving
    // starts it over, so this is not the same as "not away for long overall".
    const focusStreakMs = participant.focus_streak_ms || 0
    const onlineMs = Math.max(0, new Date(participant.last_seen_at).getTime() - new Date(participant.joined_at).getTime())
    const quiz = quizByParticipant.get(participant.id)

    let score = 0
    score += answeredQuestionIds.size * 10
    score += correctCount * 5
    score += quickCount * 5
    score += buzzerWins * 5
    score += Math.min(messageCount * 2, 20)
    if (quiz && quiz.max > 0) score += Math.round((quiz.score / quiz.max) * 20)
    // Attention is worth acknowledging in both directions, but only once the
    // student has been present long enough for the figure to mean anything.
    if (focusStreakMs >= 10 * 60_000) score += 10
    else if (onlineMs >= 10 * 60_000 && unfocusedMs >= 10 * 60_000) score -= 10

    const badges: Badge[] = []
    if (askedCount >= 3 && answeredQuestionIds.size >= askedCount) {
      badges.push({ key: 'perfect', icon: '🏅', label: '全勤', detail: `${askedCount} 題全數作答` })
    }
    if (quickCount >= 3 || buzzerWins >= 2) {
      const detail = [
        quickCount >= 3 ? `${quickCount} 次搶先作答` : '',
        buzzerWins >= 2 ? `${buzzerWins} 次搶答成功` : '',
      ].filter(Boolean).join('、')
      badges.push({ key: 'quick', icon: '⚡', label: '手快', detail })
    }
    if (gradedCount >= 3 && correctCount / gradedCount >= 0.8) {
      badges.push({ key: 'accurate', icon: '🎯', label: '神準', detail: `${correctCount}/${gradedCount} 題答對` })
    }
    if (messageCount > 4) {
      badges.push({ key: 'vocal', icon: '💬', label: '熱烈', detail: `${messageCount} 則彈幕` })
    }
    if (focusStreakMs >= 10 * 60_000) {
      badges.push({ key: 'focused', icon: '👀', label: '專注', detail: `連續專注 ${Math.floor(focusStreakMs / 60_000)} 分鐘` })
    }
    score += badges.length * BADGE_POINTS

    return {
      participant,
      score: Math.max(0, score),
      badges,
      answeredQuestionIds,
      answerCount: answeredQuestionIds.size,
      messageCount,
      gradedCount,
      correctCount,
      quickCount,
      buzzerWins,
      unfocusedMs,
      focusStreakMs,
      onlineMs,
    }
  })
}

// Buzzer results are session events rather than answers, so both callers build
// the tally the same way here instead of each counting them their own way.
export function buzzerWinsFrom(events: Array<{ event_type: string; payload: Record<string, unknown> | null }>) {
  const wins = new Map<string, number>()
  for (const event of events) {
    if (event.event_type !== 'buzzer') continue
    const winnerId = event.payload?.winner_id
    if (typeof winnerId !== 'string') continue
    wins.set(winnerId, (wins.get(winnerId) || 0) + 1)
  }
  return wins
}

export function badgeText(badges: Badge[]) {
  return badges.map((badge) => `${badge.icon}${badge.label}`).join(' ')
}
