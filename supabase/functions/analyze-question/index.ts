import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

const analysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    question_understanding: {
      type: 'object',
      additionalProperties: false,
      properties: {
        detected_question: { type: 'string' },
        subject: { type: 'string' },
        concepts: { type: 'array', items: { type: 'string' } },
        suggested_correct_answer: { type: ['string', 'null'] },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        reasoning: { type: 'string' },
      },
      required: ['detected_question', 'subject', 'concepts', 'suggested_correct_answer', 'confidence', 'reasoning'],
    },
    response_analysis: {
      type: 'object',
      additionalProperties: false,
      properties: {
        response_count: { type: 'number' },
        response_rate: { type: 'number' },
        understanding_summary: { type: 'string' },
        strengths: { type: 'array', items: { type: 'string' } },
        misconceptions: { type: 'array', items: { type: 'string' } },
        representative_patterns: { type: 'array', items: { type: 'string' } },
      },
      required: ['response_count', 'response_rate', 'understanding_summary', 'strengths', 'misconceptions', 'representative_patterns'],
    },
    teaching_recommendations: {
      type: 'object',
      additionalProperties: false,
      properties: {
        immediate_actions: { type: 'array', items: { type: 'string' } },
        explanation_points: { type: 'array', items: { type: 'string' } },
        follow_up_questions: { type: 'array', items: { type: 'string' } },
      },
      required: ['immediate_actions', 'explanation_points', 'follow_up_questions'],
    },
    limitations: { type: 'array', items: { type: 'string' } },
  },
  required: ['question_understanding', 'response_analysis', 'teaching_recommendations', 'limitations'],
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}

function extractGeminiText(response: Record<string, unknown>) {
  const candidates = Array.isArray(response.candidates) ? response.candidates : []
  const firstCandidate = candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined
  return firstCandidate?.content?.parts?.map((part) => part.text || '').join('') || ''
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  let summaryInput: Record<string, unknown> = {}
  let sessionId = ''
  let questionId = ''

  try {
    const input = await req.json()
    sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    questionId = typeof input.questionId === 'string' ? input.questionId : ''
    const presenterToken = typeof input.presenterToken === 'string' ? input.presenterToken : ''
    if (!sessionId || !questionId || !presenterToken) return jsonResponse({ message: '缺少分析所需資料。' }, 400)

    const supabase = getAdminClient()
    const tokenHash = await hashPresenterToken(presenterToken)
    const { data: keyRecord } = await supabase
      .from('presenter_session_keys')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('token_hash', tokenHash)
      .maybeSingle()

    if (!keyRecord) return jsonResponse({ message: '講者權限驗證失敗。' }, 403)

    const { data: question, error: questionError } = await supabase
      .from('questions')
      .select('*')
      .eq('id', questionId)
      .eq('session_id', sessionId)
      .single()
    if (questionError || !question) return jsonResponse({ message: '找不到題目。' }, 404)
    if (question.status === 'active') return jsonResponse({ message: '請先停止作答再執行分析。' }, 409)
    if (!question.screenshot_id) return jsonResponse({ message: '這個題目沒有截圖。' }, 400)

    const [{ data: screenshot }, { data: answers }, participantResult] = await Promise.all([
      supabase.from('screenshots').select('public_url').eq('id', question.screenshot_id).single(),
      supabase.from('answers').select('answer_value, answer_text').eq('question_id', questionId).order('submitted_at'),
      supabase.from('participants').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
    ])

    if (!screenshot?.public_url) return jsonResponse({ message: '找不到題目截圖。' }, 404)
    if (!answers?.length) return jsonResponse({ message: '目前沒有可分析的答案。' }, 400)

    const distribution = Object.fromEntries(
      (Array.isArray(question.options) ? question.options : []).map((option: string) => [
        option,
        answers.filter((answer) => answer.answer_value === option).length,
      ]),
    )
    const anonymousAnswers = answers.map((answer, index) => ({
      response_number: index + 1,
      selected_option: answer.answer_value,
      written_response: answer.answer_text,
    }))

    summaryInput = {
      question_type: question.type,
      options: question.options,
      response_count: answers.length,
      participant_count: participantResult.count || 0,
      response_rate: participantResult.count ? Math.round((answers.length / participantResult.count) * 100) : 0,
      distribution,
      anonymous_answers: anonymousAnswers,
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.5-flash'
    if (!geminiKey) return jsonResponse({ message: 'Supabase 尚未設定 GEMINI_API_KEY。' }, 503)

    const imageResponse = await fetch(screenshot.public_url)
    if (!imageResponse.ok) throw new Error(`Could not download screenshot (${imageResponse.status}).`)
    const mimeType = imageResponse.headers.get('content-type') || 'image/png'
    const imageBase64 = bytesToBase64(new Uint8Array(await imageResponse.arrayBuffer()))

    const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'x-goog-api-key': geminiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: '你是 InterAct 的課堂形成性評量分析助理。請以繁體中文分析截圖中的題目與匿名化群體作答。不可臆測看不清楚的內容；選擇題與是非題只能提出建議答案，最後決定權屬於講者。投票題不判定對錯。簡答題分析理解、證據、常見誤解與可立即採取的教學行動。',
          }],
        },
        contents: [{
          role: 'user',
          parts: [
            { text: JSON.stringify(summaryInput) },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: {
          responseFormat: {
            text: {
              mimeType: 'APPLICATION_JSON',
              schema: analysisSchema,
            },
          },
        },
      }),
    })

    if (!geminiResponse.ok) {
      const detail = (await geminiResponse.text()).slice(0, 1000)
      throw new Error(`Gemini request failed (${geminiResponse.status}): ${detail}`)
    }

    const geminiData = await geminiResponse.json()
    const outputText = extractGeminiText(geminiData)
    if (!outputText) throw new Error('Gemini returned no structured output.')
    const analysis = JSON.parse(outputText)

    const { error: summaryError } = await supabase.from('ai_summaries').insert({
      session_id: sessionId,
      question_id: questionId,
      type: 'question_analysis',
      input_json: summaryInput,
      output_json: analysis,
      status: 'success',
    })
    if (summaryError) throw summaryError

    await supabase.from('screenshots').update({ ai_status: 'success', screen_summary: analysis.question_understanding }).eq('id', question.screenshot_id)
    return jsonResponse({ analysis })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI analysis failed.'
    console.error('analyze-question failed', message)

    if (sessionId && questionId) {
      try {
        await getAdminClient().from('ai_summaries').insert({
          session_id: sessionId,
          question_id: questionId,
          type: 'question_analysis',
          input_json: summaryInput,
          output_json: { message: message.slice(0, 1000) },
          status: 'failed',
        })
      } catch {
        // The primary error is more useful than a secondary logging failure.
      }
    }

    return jsonResponse({ message: 'AI 分析失敗，請稍後再試。' }, 500)
  }
})
