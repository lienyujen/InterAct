export type Session = {
  id: string
  title: string
  code: string
  status: 'active' | 'ended'
  danmaku_enabled: boolean
  anonymous_enabled: boolean
  current_question_id: string | null
  short_join_url: string | null
  exit_ticket_prompt: string | null
  exit_ticket_category: ExitTicketCategory | null
  exit_ticket_response_type: ExitTicketResponseType | null
  created_at: string
  ended_at: string | null
}

export type Participant = {
  id: string
  session_id: string
  name: string
  device_id: string
  joined_at: string
  last_seen_at: string
}

export type Message = {
  id: string
  session_id: string
  participant_id: string
  participant_name: string
  content: string
  anonymous_at_display: boolean
  displayed: boolean
  created_at: string
}

export type Screenshot = {
  id: string
  session_id: string
  storage_path: string
  public_url: string
  screen_summary: Record<string, unknown> | null
  ai_status: 'pending' | 'success' | 'failed' | 'skipped'
  created_at: string
}

export type QuestionType = 'send_screen' | 'poll' | 'multiple_choice' | 'true_false' | 'short_answer'
export type ExitTicketCategory = 'lesson_summary' | 'learning_assessment' | 'course_satisfaction' | 'student_question'
export type ExitTicketResponseType = 'text' | 'rating'

export type SharedContent = {
  id: string
  session_id: string
  body: string | null
  url: string | null
  created_at: string
}

export type LotteryPayload = {
  round: number
  winner_id: string
  winner_name: string
  candidate_count: number
  candidate_names: string[]
  candidate_ids?: string[]
  duration_ms: number
  finalized?: boolean
}

export type SessionEvent = {
  id: string
  session_id: string
  event_type: 'lottery' | 'lottery_result'
  payload: LotteryPayload
  created_at: string
}

export type Question = {
  id: string
  session_id: string
  screenshot_id: string | null
  type: QuestionType
  status: 'draft' | 'active' | 'stopped' | 'closed'
  title: string
  prompt_text: string | null
  options: string[]
  allow_multiple: boolean
  correct_answer: string | null
  correct_answers: string[]
  started_at: string | null
  stopped_at: string | null
  created_at: string
}

export type Answer = {
  id: string
  session_id: string
  question_id: string
  participant_id: string
  participant_name: string
  answer_value: string | null
  answer_values: string[] | null
  answer_text: string | null
  is_correct: boolean | null
  submitted_at: string
}

export type QuestionAnalysis = {
  question_understanding: {
    detected_question: string
    subject: string
    concepts: string[]
    suggested_correct_answer: string | null
    confidence: 'high' | 'medium' | 'low'
    reasoning: string
  }
  response_analysis: {
    response_count: number
    response_rate: number
    understanding_summary: string
    strengths: string[]
    misconceptions: string[]
    representative_patterns: string[]
  }
  teaching_recommendations: {
    immediate_actions: string[]
    explanation_points: string[]
    follow_up_questions: string[]
  }
  limitations: string[]
}

export type SessionMetrics = {
  participant_count: number
  message_count: number
  active_message_participants: number
  question_count: number
  interactive_question_count: number
  answer_count: number
  average_response_rate: number
  assessed_answer_count: number
  correct_answer_count: number
  correct_rate: number | null
  exit_ticket_count: number
  duration_minutes: number
}

export type SessionAnalysis = {
  executive_summary: string
  engagement_analysis: {
    level: 'high' | 'medium' | 'low'
    summary: string
    participation_observations: string[]
    danmaku_observations: string[]
  }
  learning_analysis: {
    overall_understanding: string
    strengths: string[]
    misconceptions: string[]
    question_findings: Array<{
      question_id: string
      detected_question: string
      result_summary: string
      evidence: string
    }>
  }
  teaching_recommendations: {
    immediate_actions: string[]
    next_lesson_actions: string[]
    follow_up_questions: string[]
  }
  limitations: string[]
}

export type AiSummary = {
  id: string
  session_id: string
  question_id: string | null
  type: 'screen_preview' | 'short_answer_summary' | 'question_analysis' | 'exit_ticket_summary'
  input_json: Record<string, unknown>
  output_json: QuestionAnalysis | SessionAnalysis | Record<string, unknown>
  status: 'success' | 'failed'
  created_at: string
}

export type ExitTicket = {
  id: string
  session_id: string
  participant_id: string
  participant_name: string
  most_useful: string
  still_confused: string
  understanding_score: number | null
  engagement_score: number | null
  next_suggestion: string
  response_text: string | null
  rating: number | null
  submitted_at: string
}

export type SessionReportData = {
  session: Session
  participants: Participant[]
  messages: Message[]
  screenshots: Screenshot[]
  questions: Question[]
  answers: Answer[]
  aiSummaries: AiSummary[]
  exitTickets: ExitTicket[]
}
