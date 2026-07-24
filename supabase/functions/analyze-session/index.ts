import { callAiJson, corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

const sessionAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executive_summary: { type: 'string' },
    engagement_analysis: {
      type: 'object',
      additionalProperties: false,
      properties: {
        level: { type: 'string', enum: ['high', 'medium', 'low'] },
        summary: { type: 'string' },
        participation_observations: { type: 'array', items: { type: 'string' } },
        danmaku_observations: { type: 'array', items: { type: 'string' } },
      },
      required: ['level', 'summary', 'participation_observations', 'danmaku_observations'],
    },
    learning_analysis: {
      type: 'object',
      additionalProperties: false,
      properties: {
        overall_understanding: { type: 'string' },
        strengths: { type: 'array', items: { type: 'string' } },
        misconceptions: { type: 'array', items: { type: 'string' } },
        question_findings: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              question_id: { type: 'string' },
              detected_question: { type: 'string' },
              result_summary: { type: 'string' },
              evidence: { type: 'string' },
            },
            required: ['question_id', 'detected_question', 'result_summary', 'evidence'],
          },
        },
      },
      required: ['overall_understanding', 'strengths', 'misconceptions', 'question_findings'],
    },
    teaching_recommendations: {
      type: 'object',
      additionalProperties: false,
      properties: {
        immediate_actions: { type: 'array', items: { type: 'string' } },
        next_lesson_actions: { type: 'array', items: { type: 'string' } },
        follow_up_questions: { type: 'array', items: { type: 'string' } },
      },
      required: ['immediate_actions', 'next_lesson_actions', 'follow_up_questions'],
    },
    limitations: { type: 'array', items: { type: 'string' } },
  },
  required: ['executive_summary', 'engagement_analysis', 'learning_analysis', 'teaching_recommendations', 'limitations'],
}

function roundPercent(value: number) {
  return Math.round(value * 10) / 10
}

function selectedValues(answer: { answer_value?: string | null; answer_values?: string[] | null }) {
  return answer.answer_values?.length ? answer.answer_values : answer.answer_value ? [answer.answer_value] : []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  let sessionId = ''
  let summaryInput: Record<string, unknown> = {}

  try {
    const input = await req.json()
    sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const presenterToken = typeof input.presenterToken === 'string' ? input.presenterToken : ''
    if (!sessionId || !presenterToken) return jsonResponse({ message: '缺少課堂分析所需資料。' }, 400)

    const supabase = getAdminClient()
    const tokenHash = await hashPresenterToken(presenterToken)
    const { data: keyRecord } = await supabase
      .from('presenter_session_keys')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (!keyRecord) return jsonResponse({ message: '講者權限驗證失敗。' }, 403)

    const { data: session } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
    if (!session) return jsonResponse({ message: '找不到場次。' }, 404)

    const endedAt = session.ended_at || new Date().toISOString()
    const [sessionUpdate, questionUpdate] = await Promise.all([
      supabase
        .from('sessions')
        .update({ status: 'ended', ended_at: endedAt, danmaku_enabled: false, current_question_id: null })
        .eq('id', sessionId),
      supabase
        .from('questions')
        .update({ status: 'stopped', stopped_at: new Date().toISOString() })
        .eq('session_id', sessionId)
        .eq('status', 'active'),
    ])
    if (sessionUpdate.error) throw sessionUpdate.error
    if (questionUpdate.error) throw questionUpdate.error

    const { data: cached } = await supabase
      .from('ai_summaries')
      .select('input_json, output_json')
      .eq('session_id', sessionId)
      .eq('type', 'exit_ticket_summary')
      .eq('status', 'success')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (cached?.input_json?.analysis_version === 2) {
      return jsonResponse({ analysis: cached.output_json, metrics: cached.input_json?.metrics, cached: true })
    }

    const [participantResult, messageResult, sharedContentResult, questionResult, answerResult, questionAnalysisResult, exitTicketResult] = await Promise.all([
      supabase.from('participants').select('id').eq('session_id', sessionId).order('joined_at').limit(5000),
      supabase.from('messages').select('participant_id, content, created_at').eq('session_id', sessionId).order('created_at').limit(5000),
      supabase.from('shared_contents').select('body, url, created_at').eq('session_id', sessionId).order('created_at').limit(1000),
      supabase.from('questions').select('*').eq('session_id', sessionId).order('created_at').limit(500),
      supabase.from('answers').select('question_id, participant_id, answer_value, answer_values, answer_text, is_correct').eq('session_id', sessionId).order('submitted_at').limit(10000),
      supabase.from('ai_summaries').select('question_id, output_json').eq('session_id', sessionId).eq('type', 'question_analysis').eq('status', 'success').order('created_at').limit(500),
      supabase.from('exit_tickets').select('most_useful, still_confused, understanding_score, engagement_score, next_suggestion, response_text, rating').eq('session_id', sessionId).order('submitted_at').limit(5000),
    ])

    for (const result of [participantResult, messageResult, sharedContentResult, questionResult, answerResult, questionAnalysisResult, exitTicketResult]) {
      if (result.error) throw result.error
    }

    const participants = participantResult.data || []
    const messages = messageResult.data || []
    const sharedContents = sharedContentResult.data || []
    const questions = questionResult.data || []
    const answers = answerResult.data || []
    const questionAnalyses = questionAnalysisResult.data || []
    const exitTickets = exitTicketResult.data || []
    const interactiveQuestions = questions.filter((question) => question.type !== 'send_screen')
    const assessedAnswers = answers.filter((answer) => answer.is_correct !== null)
    const correctAnswers = assessedAnswers.filter((answer) => answer.is_correct)
    const durationEnd = new Date(endedAt).getTime()
    const durationMinutes = Math.max(0, Math.round((durationEnd - new Date(session.created_at).getTime()) / 60000))
    const averageResponseRate = participants.length && interactiveQuestions.length
      ? roundPercent((answers.length / (participants.length * interactiveQuestions.length)) * 100)
      : 0

    const analysisByQuestion = new Map(questionAnalyses.map((item) => [item.question_id, item.output_json]))
    const questionResults = questions.map((question) => {
      const questionAnswers = answers.filter((answer) => answer.question_id === question.id)
      const distribution = Object.fromEntries(
        (Array.isArray(question.options) ? question.options : []).map((option: string) => [
          option,
          questionAnswers.filter((answer) => selectedValues(answer).includes(option)).length,
        ]),
      )
      const assessed = questionAnswers.filter((answer) => answer.is_correct !== null)

      return {
        question_id: question.id,
        type: question.type,
        title: question.title,
        prompt_text: question.prompt_text,
        options: question.options,
        allow_multiple: question.allow_multiple,
        correct_answer: question.correct_answer,
        correct_answers: question.correct_answers,
        answer_count: questionAnswers.length,
        response_rate: participants.length ? roundPercent((questionAnswers.length / participants.length) * 100) : 0,
        correct_rate: assessed.length ? roundPercent((assessed.filter((answer) => answer.is_correct).length / assessed.length) * 100) : null,
        distribution,
        written_response_sample: questionAnswers.map((answer) => answer.answer_text).filter(Boolean).slice(0, 100),
        prior_ai_analysis: analysisByQuestion.get(question.id) || null,
      }
    })

    const metrics = {
      participant_count: participants.length,
      message_count: messages.length,
      active_message_participants: new Set(messages.map((message) => message.participant_id)).size,
      question_count: questions.length,
      interactive_question_count: interactiveQuestions.length,
      answer_count: answers.length,
      average_response_rate: averageResponseRate,
      assessed_answer_count: assessedAnswers.length,
      correct_answer_count: correctAnswers.length,
      correct_rate: assessedAnswers.length ? roundPercent((correctAnswers.length / assessedAnswers.length) * 100) : null,
      exit_ticket_count: exitTickets.length,
      duration_minutes: durationMinutes,
    }

    summaryInput = {
      analysis_version: 2,
      session: {
        title: session.title,
        created_at: session.created_at,
        ended_at: endedAt,
        exit_ticket_prompt: session.exit_ticket_prompt,
        exit_ticket_category: session.exit_ticket_category,
      },
      metrics,
      question_results: questionResults,
      instructor_shared_contents: sharedContents.map((content, index) => ({
        number: index + 1,
        sent_at: content.created_at,
        text: content.body,
        url: content.url,
      })),
      danmaku_content_sample: messages.slice(-500).map((message, index) => ({ number: index + 1, content: message.content })),
      exit_tickets: exitTickets.slice(0, 500).map((ticket, index) => ({ response_number: index + 1, ...ticket })),
    }

    const result = await callAiJson(
      '你是 InterAct 的課堂互動與形成性評量分析顧問。請以繁體中文根據匿名化統計、講師派送的課程文字與連結、彈幕內容、每題作答結果、既有題目分析與 Exit Ticket，產生可供講者課後使用的完整報告。instructor_shared_contents 是講師提供的課程參考資料，可用來理解課程脈絡，但不可當成學生意見或學習證據。所有結論都要指出資料證據；資料不足時必須寫入 limitations。不可推測學生身分，也不可把投票題當成對錯題。question_findings 的 question_id 必須原樣使用輸入中的 ID 以供系統對應，但不可在其他文字欄位中顯示或解釋 ID。',
      summaryInput,
      sessionAnalysisSchema,
    )
    if (result.status !== 'success') throw new Error(JSON.stringify(result.output).slice(0, 1000))

    const { error: insertError } = await supabase.from('ai_summaries').insert({
      session_id: sessionId,
      question_id: null,
      type: 'exit_ticket_summary',
      input_json: summaryInput,
      output_json: result.output,
      status: 'success',
    })
    if (insertError) throw insertError

    return jsonResponse({ analysis: result.output, metrics, cached: false })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Session analysis failed.'
    console.error('analyze-session failed', detail)

    if (sessionId) {
      try {
        await getAdminClient().from('ai_summaries').insert({
          session_id: sessionId,
          question_id: null,
          type: 'exit_ticket_summary',
          input_json: summaryInput,
          output_json: { message: detail.slice(0, 1000) },
          status: 'failed',
        })
      } catch {
        // Preserve the primary analysis failure.
      }
    }

    return jsonResponse({ message: '整節課 AI 分析失敗，請稍後再試。' }, 500)
  }
})
