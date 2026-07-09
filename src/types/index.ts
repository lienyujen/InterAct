export type Session = {
  id: string
  title: string
  code: string
  status: 'active' | 'ended'
  danmaku_enabled: boolean
  anonymous_enabled: boolean
  current_question_id: string | null
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

export type Question = {
  id: string
  session_id: string
  screenshot_id: string | null
  type: QuestionType
  status: 'draft' | 'active' | 'stopped' | 'closed'
  title: string
  options: string[]
  correct_answer: string | null
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
  answer_text: string | null
  is_correct: boolean | null
  submitted_at: string
}

export type ExitTicket = {
  id: string
  session_id: string
  participant_id: string
  participant_name: string
  most_useful: string
  still_confused: string
  understanding_score: number
  engagement_score: number
  next_suggestion: string
  submitted_at: string
}
