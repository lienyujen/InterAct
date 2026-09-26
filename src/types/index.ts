export type Session = {
  id: string
  title: string
  code: string
  status: 'active' | 'ended'
  danmaku_enabled: boolean
  anonymous_enabled: boolean
  current_question_id: string | null
  // The 討論板 that is open, which is not the same as the question the class is
  // on: a board stays reachable while the lesson moves on to other questions.
  board_question_id: string | null
  short_join_url: string | null
  exit_ticket_prompt: string | null
  exit_ticket_prompt_en: string | null
  exit_ticket_category: ExitTicketCategory | null
  exit_ticket_response_type: ExitTicketResponseType | null
  recording_enabled: boolean
  captions_enabled: boolean
  caption_status: 'idle' | 'starting' | 'live' | 'error'
  caption_source_language: string
  caption_display_language: string
  caption_font_size: number
  caption_font_bold: boolean
  caption_position: 'top' | 'center' | 'bottom'
  caption_started_at: string | null
  interpretation_enabled: boolean
  interpretation_audio_enabled: boolean
  interpretation_languages: string[]
  created_at: string
  ended_at: string | null
}

export type CaptionSegment = {
  id: string
  session_id: string
  language: string
  source_language: string
  text: string
  is_translation: boolean
  started_at: string | null
  ended_at: string | null
  created_at: string
}

export type Participant = {
  id: string
  session_id: string
  name: string
  device_id: string
  joined_at: string
  last_seen_at: string
  unfocused_ms?: number
  focus_streak_ms?: number
  // Set when the presenter removed them. The row and everything hanging off it
  // stays; it simply drops out of the live roster and lets that device rejoin.
  removed_at?: string | null
  // When they asked to be called on. Null once the presenter acknowledges it.
  hand_raised_at?: string | null
}

// One tap of the + beside a name. Kept per award rather than as a total so the
// report can show what the points were for, and a mistaken tap can be traced.
export type ParticipantPoint = {
  id: string
  session_id: string
  participant_id: string
  points: number
  created_at: string
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

export type QuestionType = 'send_screen' | 'poll' | 'multiple_choice' | 'true_false' | 'short_answer' | 'pronunciation' | 'oral_response' | 'custom_quiz' | 'file_upload' | 'drawing' | 'hotspot' | 'ordering' | 'matching' | 'board'

// The kinds of card a student can put on a 討論板.
export type BoardPostKind = 'text' | 'link' | 'image' | 'file' | 'audio' | 'drawing'

export type BoardPost = {
  id: string
  session_id: string
  question_id: string
  participant_id: string
  participant_name: string
  kind: BoardPostKind
  body: string | null
  url: string | null
  storage_path: string | null
  mime_type: string | null
  file_size: number | null
  duration_ms: number | null
  // Set on a reply; null on a card of its own.
  reply_to: string | null
  anonymous_at_display: boolean
  // The student corrected it after posting.
  edited_at?: string | null
  // The student took it back down.
  deleted_at: string | null
  // The presenter took it down for everyone.
  hidden_at: string | null
  pinned_at: string | null
  created_at: string
  // Filled in by whoever loaded the card rather than stored: a playable or
  // viewable address for the uploaded file, and who reacted to it.
  public_url?: string | null
  reactions?: BoardReaction[]
}

export type BoardReaction = {
  post_id: string
  participant_id: string
  emoji: string
}
export type QuizItemType = 'multiple_choice' | 'fill_blank' | 'short_answer'
export type QuizRequestedType = 'random' | QuizItemType
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

export type BuzzerPayload = {
  candidate_count: number
  candidate_ids: string[]
  prepared_at: string
  started_at?: string
  expires_at: string
  duration_ms: number
  finalized: boolean
  accepting: boolean
  cancelled?: boolean
  winner_id?: string
  winner_name?: string
  finalized_at?: string
}

export type LotterySessionEvent = {
  id: string
  session_id: string
  event_type: 'lottery' | 'lottery_result'
  payload: LotteryPayload
  created_at: string
}

export type BuzzerSessionEvent = {
  id: string
  session_id: string
  event_type: 'buzzer'
  payload: BuzzerPayload
  created_at: string
}

export type SessionEvent = LotterySessionEvent | BuzzerSessionEvent

export type Question = {
  id: string
  session_id: string
  screenshot_id: string | null
  type: QuestionType
  status: 'draft' | 'active' | 'stopped' | 'closed'
  title: string
  prompt_text: string | null
  options: string[]
  translations: {
    en?: {
      title?: string
      prompt_text?: string | null
      options?: string[]
    }
  }
  allow_multiple: boolean
  correct_answer: string | null
  correct_answers: string[]
  // Null means untimed; src/lib/questionTiming.ts decides which types carry which.
  prepare_seconds: number | null
  answer_seconds: number | null
  // How many points one student may drop on a hotspot image; null elsewhere.
  max_pins: number | null
  // Matching only: the right-hand column the class picks from, shuffled.
  // Ordering keeps its items in options, so it needs nothing here.
  choices: string[]
  // 排序題 only: the pieces are one sentence cut up rather than a list to rank.
  sentence_mode: boolean
  // Whether the class is shown the capture this question was made from.
  share_screenshot: boolean
  // 討論板: which kinds of card the class may put up. Empty is the plain
  // 派送畫面 this type has always been — a board is the same dispatch with
  // replies switched on.
  board_formats: BoardPostKind[]
  // How many cards one student may put up; null is the ∞ option.
  board_max_posts: number | null
  // When the presenter opened the board to the class. Until then each student
  // sees only their own cards.
  board_revealed_at: string | null
  // Bumped by 再做一次; answers carry the round they were given in.
  answer_round: number
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
  round: number
  submitted_at: string
}

export type AudioAnalysis = {
  mode: 'pronunciation' | 'oral_response'
  detected_language: string
  transcript: string
  score: number
  summary: string
  relevance: string
  clarity: string
  completeness: string
  strengths: string[]
  improvements: string[]
  limitations: string[]
  translations?: { en?: Omit<AudioAnalysis, 'translations'> }
}

export type AudioResponse = {
  id: string
  session_id: string
  question_id: string
  participant_id: string
  participant_name: string
  mime_type: string
  duration_ms: number
  analysis_status: 'pending' | 'success' | 'failed'
  detected_language: string | null
  transcript: string | null
  score: number | null
  analysis_json: AudioAnalysis | null
  error_message: string | null
  submitted_at: string
  analyzed_at: string | null
  signed_url?: string | null
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
  audio_response_count: number
  analyzed_audio_count: number
  average_audio_score: number | null
  // Written earlier than the fields above by older analyses, which is why
  // these are optional: a report generated before uploads existed has none.
  file_submission_count?: number
  file_count?: number
  marked_file_submission_count?: number
  average_file_score?: number | null
  duration_minutes: number
}

export type SessionAnalysis = {
  executive_summary: string
  lesson_key_points: string[]
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
  translations?: { en?: Omit<SessionAnalysis, 'translations'> }
}

export type Quiz = {
  id: string
  session_id: string
  question_id: string
  title: string
  direction: string
  requested_count: number | null
  requested_type: QuizRequestedType
  total_points: number
  created_at: string
}

export type QuizItem = {
  id: string
  quiz_id: string
  position: number
  type: QuizItemType
  prompt_text: string
  options: string[]
  points: number
  translations: {
    en?: {
      prompt_text?: string
      options?: string[]
    }
  }
  created_at: string
}

export type QuizAttemptStatus = 'grading' | 'graded' | 'failed'

export type QuizAttempt = {
  id: string
  session_id: string
  question_id: string
  quiz_id: string
  participant_id: string
  participant_name: string
  status: QuizAttemptStatus
  total_score: number | null
  max_score: number
  feedback: { zh_tw?: string; en?: string } | null
  error_message: string | null
  submitted_at: string
  graded_at: string | null
}

export type QuizItemAnswer = {
  id: string
  attempt_id: string
  item_id: string
  answer_text: string | null
  answer_values: string[] | null
  score: number | null
  feedback: { zh_tw?: string; en?: string } | null
  created_at: string
}

export type ParticipantQuizData = {
  quiz: Quiz
  items: QuizItem[]
  attempt: QuizAttempt | null
  answers: QuizItemAnswer[]
  // What each item would have accepted. Empty while the quiz is still
  // open, because then it is still the answer.
  keys?: Array<{ item_id: string; accepted_answers: string[] }>
}

export type PresenterQuizResults = ParticipantQuizData & {
  attempts: QuizAttempt[]
  answers: QuizItemAnswer[]
  keys: Array<{ item_id: string; accepted_answers: string[]; rubric: string }>
  screenshot: Screenshot | null
}

export type SessionCustomQuizResults = {
  quizzes: Quiz[]
  items: QuizItem[]
  attempts: QuizAttempt[]
  answers: QuizItemAnswer[]
  keys: Array<{ item_id: string; accepted_answers: string[]; rubric: string }>
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

// A line of the class list as the report needs it. Declared here rather than
// imported from lib/classRoster so the type layer keeps pointing one way.
export type ReportRosterEntry = {
  id: string
  name: string
  studentNo: string
  unit: string
}

export type SessionReportData = {
  session: Session
  participants: Participant[]
  participantPoints: ParticipantPoint[]
  // The class list this session was taught against, read off this computer. Null
  // when the presenter did not use one — then the report is exactly what it was.
  roster: { name: string; entries: ReportRosterEntry[] } | null
  messages: Message[]
  // Every card put on a 討論板, including the ones a student took back and the
  // ones the presenter took down — what was written is part of what happened
  // in the room even when it was not left up.
  boardPosts: BoardPost[]
  sharedContents: SharedContent[]
  captionSegments: CaptionSegment[]
  screenshots: Screenshot[]
  questions: Question[]
  answers: Answer[]
  audioResponses: AudioResponse[]
  fileResponses: FileResponse[]
  buzzerEvents: SessionEvent[]
  customQuizResults: SessionCustomQuizResults
  aiSummaries: AiSummary[]
  exitTickets: ExitTicket[]
}

export interface SharedFile {
  id: string
  session_id: string
  name: string
  mime_type: string
  file_size: number
  storage_path: string
  created_at: string
  file_url?: string
}

export type FileAnalysisStatus = 'pending' | 'analyzing' | 'success' | 'failed' | 'unsupported'

export type FileVerdict = 'correct' | 'partial' | 'incorrect' | 'unscored'

export interface FileAnalysis {
  // Absent on anything marked before grading existed, so both stay optional.
  verdict?: FileVerdict
  score?: number | null
  summary_zh_tw: string
  summary_en: string
  strengths_zh_tw: string[]
  strengths_en: string[]
  improvements_zh_tw: string[]
  improvements_en: string[]
}

export interface FileResponse {
  id: string
  session_id: string
  question_id: string
  participant_id: string
  participant_name: string
  name: string
  mime_type: string
  file_size: number
  storage_path: string
  analysis_status: FileAnalysisStatus
  analysis_json: FileAnalysis | null
  error_message: string | null
  submitted_at: string
  analyzed_at: string | null
  file_url?: string
}
