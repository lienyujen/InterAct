import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

const exitTicketSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    category: {
      type: 'string',
      enum: ['lesson_summary', 'course_satisfaction', 'student_question'],
    },
    prompt: { type: 'string' },
  },
  required: ['category', 'prompt'],
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function extractText(response: Record<string, unknown>) {
  const candidates = Array.isArray(response.candidates) ? response.candidates : []
  const first = candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined
  return first?.content?.parts?.map((part) => part.text || '').join('') || ''
}

function selectedValues(answer: { answer_value?: string | null; answer_values?: string[] | null }) {
  return answer.answer_values?.length ? answer.answer_values : answer.answer_value ? [answer.answer_value] : []
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const input = await req.json()
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const presenterToken = typeof input.presenterToken === 'string' ? input.presenterToken : ''
    if (!sessionId || !presenterToken) return jsonResponse({ message: '?? Exit Ticket ?????' }, 400)

    const supabase = getAdminClient()
    const tokenHash = await hashPresenterToken(presenterToken)
    const { data: keyRecord } = await supabase
      .from('presenter_session_keys')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (!keyRecord) return jsonResponse({ message: '?????????' }, 403)

    const { data: session } = await supabase.from('sessions').select('*').eq('id', sessionId).single()
    if (!session) return jsonResponse({ message: '??????' }, 404)
    if (session.exit_ticket_prompt) {
      return jsonResponse({
        prompt: session.exit_ticket_prompt,
        category: session.exit_ticket_category,
        responseType: session.exit_ticket_response_type,
        cached: true,
      })
    }

    const [questionResult, answerResult, messageResult, screenshotResult, analysisResult, participantResult] = await Promise.all([
      supabase.from('questions').select('*').eq('session_id', sessionId).order('created_at').limit(500),
      supabase.from('answers').select('question_id, answer_value, answer_values, answer_text, is_correct').eq('session_id', sessionId).order('submitted_at').limit(10000),
      supabase.from('messages').select('content, created_at').eq('session_id', sessionId).order('created_at').limit(5000),
      supabase.from('screenshots').select('id, public_url').eq('session_id', sessionId).order('created_at').limit(500),
      supabase.from('ai_summaries').select('question_id, output_json').eq('session_id', sessionId).eq('type', 'question_analysis').eq('status', 'success').order('created_at').limit(500),
      supabase.from('participants').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
    ])
    for (const result of [questionResult, answerResult, messageResult, screenshotResult, analysisResult, participantResult]) {
      if (result.error) throw result.error
    }

    const questions = questionResult.data || []
    const answers = answerResult.data || []
    const messages = messageResult.data || []
    const screenshots = new Map((screenshotResult.data || []).map((item) => [item.id, item.public_url]))
    const analyses = new Map((analysisResult.data || []).map((item) => [item.question_id, item.output_json]))
    const questionSummaries = questions.map((question, index) => {
      const questionAnswers = answers.filter((answer) => answer.question_id === question.id)
      const distribution = Object.fromEntries(
        (Array.isArray(question.options) ? question.options : []).map((option: string) => [
          option,
          questionAnswers.filter((answer) => selectedValues(answer).includes(option)).length,
        ]),
      )
      const priorAnalysis = analyses.get(question.id) as { question_understanding?: { detected_question?: string } } | undefined

      return {
        question_number: index + 1,
        type: question.type,
        presenter_question: question.prompt_text,
        ai_detected_question: priorAnalysis?.question_understanding?.detected_question || null,
        options: question.options,
        allow_multiple: question.allow_multiple,
        answer_count: questionAnswers.length,
        distribution,
        written_answers: questionAnswers.map((answer) => answer.answer_text).filter(Boolean).slice(0, 100),
        correct_count: questionAnswers.filter((answer) => answer.is_correct === true).length,
        assessed_count: questionAnswers.filter((answer) => answer.is_correct !== null).length,
      }
    })
    const summaryInput = {
      session_title: session.title,
      participant_count: participantResult.count || 0,
      questions: questionSummaries,
      danmaku: messages.slice(-500).map((message, index) => ({ number: index + 1, content: message.content })),
    }

    const parts: Array<Record<string, unknown>> = [{ text: JSON.stringify(summaryInput) }]
    let totalImageBytes = 0
    for (let index = 0; index < questions.length; index += 1) {
      const question = questions[index]
      const imageUrl = question.screenshot_id ? screenshots.get(question.screenshot_id) : null
      if (!imageUrl || totalImageBytes >= 18_000_000) continue
      try {
        const response = await fetch(imageUrl)
        if (!response.ok) continue
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.length > 4_000_000 || totalImageBytes + bytes.length > 18_000_000) continue
        totalImageBytes += bytes.length
        parts.push({ text: `???? ${index + 1} ????` })
        parts.push({ inlineData: { mimeType: response.headers.get('content-type') || 'image/png', data: bytesToBase64(bytes) } })
      } catch {
        // Text, options, answers, and prior analysis still provide useful context.
      }
    }

    const apiKey = Deno.env.get('GEMINI_API_KEY')
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'
    if (!apiKey) return jsonResponse({ message: 'AI ???????' }, 503)

    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: '?? InterAct ??? Exit Ticket ?????????????????????????????????????????????????????? 1 ? 5 ?????????????????????????????????????????????????????????????????????? category???????????????????????????????? 80 ?????lesson_summary ????????????????student_question ????????????course_satisfaction ???????????????????????????????????????????????????????????????course_satisfaction ??????????????????????????? AI??????????????????',
          }],
        },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: exitTicketSchema } },
        },
      }),
    })
    if (!aiResponse.ok) throw new Error(`AI request failed (${aiResponse.status}): ${(await aiResponse.text()).slice(0, 1000)}`)
    const outputText = extractText(await aiResponse.json())
    if (!outputText) throw new Error('AI returned no Exit Ticket.')
    const output = JSON.parse(outputText) as { category: string; prompt: string }
    const allowedCategories = ['lesson_summary', 'course_satisfaction', 'student_question']
    if (!allowedCategories.includes(output.category) || !output.prompt?.trim()) throw new Error('AI returned an invalid Exit Ticket.')

    const responseType = 'text'
    const prompt = output.prompt.trim().slice(0, 240)
    const { error: updateError } = await supabase
      .from('sessions')
      .update({
        exit_ticket_prompt: prompt,
        exit_ticket_category: output.category,
        exit_ticket_response_type: responseType,
      })
      .eq('id', sessionId)
    if (updateError) throw updateError

    return jsonResponse({ prompt, category: output.category, responseType, cached: false })
  } catch (error) {
    console.error('generate-exit-ticket failed', error instanceof Error ? error.message : error)
    return jsonResponse({ message: 'Exit Ticket ???????????' }, 500)
  }
})
