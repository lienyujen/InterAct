import { corsHeaders, jsonResponse, errorDetail } from '../_shared/ai.ts'
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

function selectedValues(answer: { answer_value?: string | null; answer_values?: string[] | null }) {
  return answer.answer_values?.length ? answer.answer_values : answer.answer_value ? [answer.answer_value] : []
}

function extractGeminiText(response: Record<string, unknown>) {
  const candidates = Array.isArray(response.candidates) ? response.candidates : []
  const firstCandidate = candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined
  return firstCandidate?.content?.parts?.map((part) => part.text || '').join('') || ''
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

async function requestAnalysis(apiKey: string, models: string[], body: string) {
  let failureMessage = 'Gemini request failed.'

  for (const [index, model] of models.entries()) {
    let response: Response
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(index === 0 ? 12_000 : 18_000),
      })
    } catch (error) {
      failureMessage = error instanceof Error ? error.message : 'Gemini request failed.'
      console.warn(`Question analysis request failed on ${model}; trying the fallback model.`)
      continue
    }

    if (response.ok) return response
    failureMessage = (await response.text()).slice(0, 1000) || `Gemini request failed (${response.status}).`
    if (!retryableStatus(response.status)) throw new Error(failureMessage)
    console.warn(`Question analysis unavailable on ${model}; trying the fallback model.`)
  }

  throw new Error(failureMessage)
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
    // An upload question collected through the file panel has no screenshot; it
    // is analysed from what the marker already wrote about each submission.
    const isFileUpload = question.type === 'file_upload'
    if (!question.screenshot_id && !isFileUpload) return jsonResponse({ message: '這個題目沒有截圖。' }, 400)

    const [{ data: screenshot }, { data: answers }, participantResult, { data: uploads }] = await Promise.all([
      question.screenshot_id
        ? supabase.from('screenshots').select('public_url').eq('id', question.screenshot_id).single()
        : Promise.resolve({ data: null }),
      supabase.from('answers').select('answer_value, answer_values, answer_text').eq('question_id', questionId).order('submitted_at'),
      supabase.from('participants').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
      isFileUpload
        ? supabase.from('file_responses')
          .select('participant_id, name, analysis_status, analysis_json, error_message')
          .eq('question_id', questionId).order('submitted_at')
        : Promise.resolve({ data: null }),
    ])

    if (question.screenshot_id && !screenshot?.public_url) return jsonResponse({ message: '找不到題目截圖。' }, 404)
    if (isFileUpload) {
      if (!uploads?.length) return jsonResponse({ message: '目前沒有學生上傳的作答。' }, 400)
      if (!uploads.some((upload) => upload.analysis_status === 'success')) {
        return jsonResponse({ message: '請先批改至少一份作答，再執行完整分析。' }, 400)
      }
    } else if (!answers?.length) {
      return jsonResponse({ message: '目前沒有可分析的答案。' }, 400)
    }

    const distribution = Object.fromEntries(
      (Array.isArray(question.options) ? question.options : []).map((option: string) => [
        option,
        (answers || []).filter((answer) => selectedValues(answer).includes(option)).length,
      ]),
    )
    // The uploads were marked one at a time already. Re-reading the images here
    // would bill the whole class a second time, so the class picture is built
    // from those written marks — text in, text out.
    // One student's pages carry the same mark, so they count once here; left
    // per file, a two-page essay would read as two students in the response rate.
    const submissions = isFileUpload
      ? [...(uploads || []).reduce((byStudent, upload) => {
        const kept = byStudent.get(upload.participant_id)
        // A student can attach something the model cannot open alongside the
        // page it can. The mark lives on the readable row, so that is the one
        // that speaks for them here.
        const better = !kept
          || (kept.analysis_status !== 'success' && upload.analysis_status === 'success')
          || (kept.analysis_status === 'unsupported' && upload.analysis_status !== 'unsupported')
        if (better) byStudent.set(upload.participant_id, upload)
        return byStudent
      }, new Map()).values()]
      : []
    const anonymousAnswers = isFileUpload
      ? submissions.map((upload, index) => ({
        response_number: index + 1,
        marked: upload.analysis_status === 'success',
        verdict: upload.analysis_json?.verdict ?? null,
        score: upload.analysis_json?.score ?? null,
        written_response: upload.analysis_status === 'success'
          ? upload.analysis_json?.summary_zh_tw || ''
          : upload.error_message || '尚未批改',
        improvements: upload.analysis_json?.improvements_zh_tw || [],
      }))
      : (answers || []).map((answer, index) => ({
        response_number: index + 1,
        selected_options: selectedValues(answer),
        written_response: answer.answer_text,
      }))
    const responseCount = isFileUpload ? submissions.length : (answers || []).length

    summaryInput = {
      question_type: question.type,
      presenter_question: question.prompt_text,
      options: question.options,
      allow_multiple: question.allow_multiple,
      correct_answers: question.correct_answers,
      response_count: responseCount,
      participant_count: participantResult.count || 0,
      response_rate: participantResult.count ? Math.round((responseCount / participantResult.count) * 100) : 0,
      distribution,
      anonymous_answers: anonymousAnswers,
    }

    const geminiKey = Deno.env.get('GEMINI_API_KEY')
    const realtimeModel = Deno.env.get('GEMINI_REALTIME_MODEL') || 'gemini-3.6-flash'
    const fallbackModel = Deno.env.get('GEMINI_REALTIME_FALLBACK_MODEL') || 'gemini-3.5-flash'
    if (!geminiKey) return jsonResponse({ message: 'Supabase 尚未設定 GEMINI_API_KEY。' }, 503)

    const parts: Array<Record<string, unknown>> = [{ text: JSON.stringify(summaryInput) }]
    if (screenshot?.public_url) {
      const imageResponse = await fetch(screenshot.public_url)
      if (!imageResponse.ok) throw new Error(`Could not download screenshot (${imageResponse.status}).`)
      const mimeType = imageResponse.headers.get('content-type') || 'image/png'
      parts.push({ inlineData: { mimeType, data: bytesToBase64(new Uint8Array(await imageResponse.arrayBuffer())) } })
    }

    // Upload questions were marked file by file already, so this pass reads the
    // marks rather than the images and the class picture costs one text call.
    const instruction = isFileUpload
      ? '你是 InterAct 的課堂形成性評量分析助理。這是一題「上傳作答」：學生把答案寫在紙上或做成檔案後上傳，每份都已由 AI 逐份批改，anonymous_answers 帶的是每份批改的判定、分數與摘要，不是學生原文。請以繁體中文彙整全班表現。若有題目截圖請據以判讀題目；沒有截圖時以 presenter_question 為準。suggested_correct_answer 一律填 null，因為這種題型沒有選項可選。response_analysis 要指出全班共通的正確作法與反覆出現的錯誤步驟，並說明尚未批改的份數對結論的影響。teaching_recommendations 要針對觀察到的錯誤給出可立即執行的講解與追問。不可臆測尚未批改的內容。'
      : '你是 InterAct 的課堂形成性評量分析助理。請以繁體中文分析截圖中的題目與匿名化群體作答。若 presenter_question 有內容，detected_question 應優先忠實使用該題目；若為空，截圖有明確題幹時忠實轉寫或精簡，沒有明顯題幹時依畫面脈絡與選項產生中立、不誘導且不暗示正解的題目。無論是否有 presenter_question，都必須繼續根據截圖、選項及實際作答行為分析理解、證據、常見誤解與教學行動，不可只依題目文字推測。選擇題與是非題只能提出建議答案，最後決定權屬於講者。投票題不判定對錯。'

    const requestPayload = {
        systemInstruction: { parts: [{ text: instruction }] },
        contents: [{ role: 'user', parts }],
      }

    function requestBodyForModel() {
      // responseFormat uses JSON Schema on Gemini 3.x and Gemini 2.5. The
      // legacy responseSchema field uses a restricted dialect and rejects
      // keywords such as additionalProperties and nullable type arrays.
      const generationConfig = {
        thinkingConfig: { thinkingLevel: 'LOW' },
        responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: analysisSchema } },
      }
      return JSON.stringify({ ...requestPayload, generationConfig })
    }

    const models = fallbackModel === realtimeModel ? [realtimeModel] : [realtimeModel, fallbackModel]
    const geminiResponse = await requestAnalysis(geminiKey, models, requestBodyForModel())

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

    if (question.screenshot_id) {
      await supabase.from('screenshots').update({ ai_status: 'success', screen_summary: analysis.question_understanding }).eq('id', question.screenshot_id)
    }
    return jsonResponse({ analysis })
  } catch (error) {
    const message = errorDetail(error, 'AI analysis failed.')
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
