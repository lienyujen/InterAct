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
    // A board is meant to stay open for the whole lesson, so waiting for it to
    // stop would mean never analysing it. Every other type keeps the rule:
    // analysing while answers are still arriving describes a moment that has
    // already passed by the time it is read.
    if (question.status === 'active' && question.type !== 'board') {
      return jsonResponse({ message: '請先停止作答再執行分析。' }, 409)
    }
    // An upload question collected through the file panel has no screenshot; it
    // is analysed from what the marker already wrote about each submission.
    // 電寫題 hands in the same thing — one marked image per student — and is
    // read the same way; only the sentence describing where it came from differs.
    const isDrawing = question.type === 'drawing'
    const isFileUpload = question.type === 'file_upload' || isDrawing
    // A spoken answer's row in `answers` is the placeholder [錄音已送出]; the
    // substance is the per-student evaluation, which is what this reads.
    const isSpoken = question.type === 'pronunciation' || question.type === 'oral_response'
    // A board is often dispatched without sending the capture — the topic is
    // the question — so it cannot be made to require one.
    const isBoard = question.type === 'board'
    if (!question.screenshot_id && !isFileUpload && !isBoard) return jsonResponse({ message: '這個題目沒有截圖。' }, 400)

    const [{ data: screenshot }, { data: answers }, participantResult, { data: spoken }, { data: uploads }, { data: boardPosts }] = await Promise.all([
      question.screenshot_id
        ? supabase.from('screenshots').select('public_url').eq('id', question.screenshot_id).single()
        : Promise.resolve({ data: null }),
      supabase.from('answers').select('answer_value, answer_values, answer_text').eq('question_id', questionId).order('submitted_at'),
      supabase.from('participants').select('id', { count: 'exact', head: true }).eq('session_id', sessionId),
      isSpoken
        ? supabase.from('audio_responses')
          .select('participant_id, analysis_status, detected_language, transcript, score, analysis_json')
          .eq('question_id', questionId).order('submitted_at')
        : Promise.resolve({ data: null }),
      isFileUpload
        ? supabase.from('file_responses')
          .select('participant_id, name, analysis_status, analysis_json, error_message')
          .eq('question_id', questionId).order('submitted_at')
        : Promise.resolve({ data: null }),
      isBoard
        ? supabase.from('board_posts')
          .select('participant_id, kind, body, url, reply_to, deleted_at, hidden_at')
          .eq('question_id', questionId).order('created_at')
        : Promise.resolve({ data: null }),
    ])

    if (question.screenshot_id && !screenshot?.public_url) return jsonResponse({ message: '找不到題目截圖。' }, 404)
    if (isFileUpload) {
      if (!uploads?.length) return jsonResponse({ message: '目前沒有學生上傳的作答。' }, 400)
      if (!uploads.some((upload) => upload.analysis_status === 'success')) {
        return jsonResponse({ message: '請先批改至少一份作答，再執行完整分析。' }, 400)
      }
    } else if (isSpoken) {
      if (!spoken?.some((item) => item.analysis_status === 'success')) {
        return jsonResponse({ message: '請先等錄音完成 AI 評測，再執行完整分析。' }, 400)
      }
    } else if (isBoard) {
      // Cards the class can see. A card its author took back, or one the
      // presenter took down, is not part of the discussion being analysed.
      const live = (boardPosts || []).filter((post) => !post.deleted_at && !post.hidden_at)
      if (!live.length) return jsonResponse({ message: '討論板上還沒有內容可以分析。' }, 400)
      if (!live.some((post) => post.body || post.url)) {
        return jsonResponse({ message: '討論板上目前只有圖片、檔案或錄音，沒有文字可以分析。' }, 400)
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
    const anonymousAnswers = isSpoken
      ? (spoken || []).map((item, index) => ({
        response_number: index + 1,
        assessed: item.analysis_status === 'success',
        detected_language: item.detected_language,
        score: item.score,
        transcript: item.transcript,
        summary: item.analysis_json?.summary ?? null,
        relevance: item.analysis_json?.relevance ?? null,
        clarity: item.analysis_json?.clarity ?? null,
        completeness: item.analysis_json?.completeness ?? null,
        strengths: item.analysis_json?.strengths ?? [],
        improvements: item.analysis_json?.improvements ?? [],
      }))
      : isFileUpload
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
      : isBoard
      // What a card said, and whether it answered the topic or a classmate.
      // The pictures, files and recordings are counted rather than sent: a
      // wall of thirty photographs would cost more than the reading is worth,
      // and the model should say so rather than pretend it saw them.
      ? (boardPosts || [])
        .filter((post) => !post.deleted_at && !post.hidden_at)
        .map((post, index) => ({
          response_number: index + 1,
          card_type: post.kind,
          is_reply: Boolean(post.reply_to),
          written_response: post.body || post.url || null,
        }))
      : (answers || []).map((answer, index) => ({
        response_number: index + 1,
        selected_options: selectedValues(answer),
        written_response: answer.answer_text,
      }))
    const liveCards = (boardPosts || []).filter((post) => !post.deleted_at && !post.hidden_at)
    const responseCount = isSpoken ? (spoken || []).length
      : isFileUpload ? submissions.length
      // Cards of their own, not replies: the response rate is how much of the
      // class put something on the wall.
      : isBoard ? liveCards.filter((post) => !post.reply_to).length
      : (answers || []).length

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
      ...(isBoard ? {
        board_formats: question.board_formats,
        // So the model knows what it has not been shown.
        card_counts: ['text', 'link', 'image', 'file', 'audio', 'drawing'].reduce(
          (counts: Record<string, number>, kind) => ({
            ...counts,
            [kind]: liveCards.filter((post) => post.kind === kind && !post.reply_to).length,
          }), {}),
        reply_count: liveCards.filter((post) => post.reply_to).length,
        contributor_count: new Set(liveCards.filter((post) => !post.reply_to).map((post) => post.participant_id)).size,
      } : {}),
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
    const spokenInstruction = '你是 InterAct 的課堂形成性評量分析助理。這是一題口說作答（朗讀發音或口語表達）：每位學生各自錄音，並已由 AI 逐份評測，anonymous_answers 帶的是每份評測的分數、辨識語言、逐字稿與個別評語，不是原始音檔。請以繁體中文彙整全班的口說表現。若有題目截圖請據以判讀題目要求。suggested_correct_answer 一律填 null，口說沒有單一正解。response_analysis 要指出全班共通的優點、反覆出現的發音或表達問題，以及分數分布的意義；不可只把個別評語抄一遍，要看出跨學生的模式。teaching_recommendations 要針對聽到的問題給出可立即帶全班做的練習。尚未完成評測的份數要說明其對結論的影響，不可臆測其內容。'
    const boardInstruction = '你是 InterAct 的課堂形成性評量分析助理。這是一面「討論板」：學生把自己的想法貼在同一面牆上，彼此看得見，也可以互相回覆。anonymous_answers 每一筆是一張卡片，card_type 是它的型式，is_reply 為 true 代表那是回覆同學而不是回應主題。請以繁體中文彙整整面牆。detected_question 以 presenter_question 為準；若為空且有截圖，依截圖判讀討論主題。suggested_correct_answer 一律填 null，討論沒有標準答案。response_analysis 要看出跨學生的模式：有哪幾種立場或角度、哪些想法重覆出現、哪些只有一個人提到卻值得全班看見、以及回覆裡有沒有真正的互相回應（而不是各說各話）。card_counts 裡的圖片、檔案、錄音與電繪只給了數量，你沒有看到它們的內容，若它們佔多數必須明說結論只根據文字與連結，不可臆測那些卡片畫了或說了什麼。teaching_recommendations 要針對牆上實際出現的分歧或缺口，給出可以立刻帶全班做的下一步。'
    const instruction = isBoard ? boardInstruction : isSpoken ? spokenInstruction : isFileUpload
      ? `你是 InterAct 的課堂形成性評量分析助理。${isDrawing
        ? '這是一題「電寫題」：學生直接在題目畫面上手寫或畫出解題過程與答案，'
        : '這是一題「上傳作答」：學生把答案寫在紙上或做成檔案後上傳，'}每份都已由 AI 逐份批改，anonymous_answers 帶的是每份批改的判定、分數與摘要，不是學生原文。請以繁體中文彙整全班表現。若有題目截圖請據以判讀題目；沒有截圖時以 presenter_question 為準。suggested_correct_answer 一律填 null，因為這種題型沒有選項可選。response_analysis 要指出全班共通的正確作法與反覆出現的錯誤步驟，並說明尚未批改的份數對結論的影響。teaching_recommendations 要針對觀察到的錯誤給出可立即執行的講解與追問。不可臆測尚未批改的內容。`
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
