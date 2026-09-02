import { callAiJson, geminiModels, geminiThinkingConfig, errorDetail } from './ai.ts'
import { getAdminClient } from './supabase.ts'

type RequestedType = 'random' | 'multiple_choice' | 'fill_blank' | 'short_answer'
type ItemType = Exclude<RequestedType, 'random'>

const itemTypes = new Set<ItemType>(['multiple_choice', 'fill_blank', 'short_answer'])

const quizGenerationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          type: { type: 'string', enum: ['multiple_choice', 'fill_blank', 'short_answer'] },
          prompt_text: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          accepted_answers: { type: 'array', items: { type: 'string' } },
          rubric: { type: 'string' },
          translation_en: {
            type: 'object',
            additionalProperties: false,
            properties: {
              prompt_text: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
            },
            required: ['prompt_text', 'options'],
          },
        },
        required: ['type', 'prompt_text', 'options', 'accepted_answers', 'rubric', 'translation_en'],
      },
    },
  },
  required: ['title', 'items'],
}

const gradingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    evaluations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          item_id: { type: 'string' },
          score: { type: 'number' },
          feedback_zh_tw: { type: 'string' },
          feedback_en: { type: 'string' },
        },
        required: ['item_id', 'score', 'feedback_zh_tw', 'feedback_en'],
      },
    },
    overall_feedback_zh_tw: { type: 'string' },
    overall_feedback_en: { type: 'string' },
  },
  required: ['evaluations', 'overall_feedback_zh_tw', 'overall_feedback_en'],
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
  const candidate = candidates[0] as { content?: { parts?: Array<{ text?: string }> } } | undefined
  return candidate?.content?.parts?.map((part) => part.text || '').join('') || ''
}

function cleanStrings(value: unknown, limit = 10) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => typeof item === 'string' ? item.trim() : '').filter(Boolean))].slice(0, limit)
}

function normalizedAnswer(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase().replace(/[\s.,，。！？!?、;；:'"「」『』（）()]/g, '')
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function retryDelay(attempt: number) {
  return 900 * (2 ** attempt) + Math.floor(Math.random() * 400)
}

function retryableStatus(status: number) {
  return status === 408 || status === 429 || status >= 500
}

async function requestQuizGeneration(
  apiKey: string,
  model: string,
  body: string,
  attempts: number,
  timeoutMilliseconds: number,
) {
  let failureMessage = 'network request failed'
  let failureStatus: number | null = null

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(timeoutMilliseconds),
      })
      if (response.ok) return { response, failureMessage: '', failureStatus: null }

      failureStatus = response.status
      failureMessage = (await response.text()).slice(0, 1000) || `request failed with status ${response.status}`
      if (!retryableStatus(response.status)) break
    } catch (error) {
      failureStatus = null
      failureMessage = error instanceof Error ? error.message : 'network request failed'
    }

    if (attempt < attempts - 1) await wait(retryDelay(attempt))
  }

  return { response: null, failureMessage, failureStatus }
}

export async function generateCustomQuiz(input: {
  screenshotUrl: string
  direction: string
  requestedCount: number | null
  requestedType: RequestedType
}) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  const [model, fallbackModel] = geminiModels('realtime')
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.')

  const imageResponse = await fetch(input.screenshotUrl)
  if (!imageResponse.ok) throw new Error(`Could not download screenshot (${imageResponse.status}).`)
  const mimeType = imageResponse.headers.get('content-type') || 'image/png'
  const imageBase64 = bytesToBase64(new Uint8Array(await imageResponse.arrayBuffer()))

  const countInstruction = input.requestedCount
    ? `必須產生恰好 ${input.requestedCount} 題。`
    : '題數由出題方向決定；若沒有指定，請依素材產生 5 題，最多 10 題。'
  const typeInstruction = input.requestedType === 'random'
    ? '可依出題方向與素材混合使用選擇、填充與簡答題。'
    : `每一題都必須是 ${input.requestedType}。`
  const requestedLanguage = /(?:英文|英語|english)/i.test(input.direction)
    ? 'English'
    : /(?:繁體中文|正體中文|traditional chinese|zh-tw)/i.test(input.direction)
      ? 'Traditional Chinese (Taiwan)'
      : 'auto'
  const languageInstruction = requestedLanguage === 'auto'
    ? '題目、選項、答案與評分準則必須使用教師在出題方向中指定的語言；若未指定，使用出題方向與教材的主要語言。'
    : `教師已指定測驗語言為 ${requestedLanguage}；題目標題、題幹、選項、答案與評分準則都必須使用 ${requestedLanguage}。`

  const requestPayload = {
    systemInstruction: {
      parts: [{
        text: `你是 InterAct 的測驗設計助理。請根據教師截圖和出題方向建立適合課堂即時作答的測驗。${languageInstruction} translation_en 一律提供忠實自然的英文版本；若主文已是英文則保持相同意思。${countInstruction}${typeInstruction} 選擇題須有 2 至 6 個互不重複的選項，accepted_answers 只能包含正確選項原文。填充題請在題幹使用 ____ 標示作答處，accepted_answers 提供可接受答案與常見同義答案。簡答題提供參考答案於 accepted_answers，並在 rubric 寫出具體評分準則。不得捏造截圖無法支持的專有事實；若截圖資訊有限，應依教師的出題方向設計可合理回答的理解題。`,
      }],
    },
    contents: [{
      role: 'user',
      parts: [
        { text: JSON.stringify({ direction: input.direction, requested_count: input.requestedCount, requested_type: input.requestedType, requested_language: requestedLanguage }) },
        { inlineData: { mimeType, data: imageBase64 } },
      ],
    }],
  }

  function requestBodyForModel() {
    // The current Generate Content API accepts JSON Schema through
    // responseFormat for both Gemini 3.x and Gemini 2.5. responseSchema is a
    // different, restricted schema dialect and rejects JSON Schema keywords.
    const generationConfig = {
      thinkingConfig: geminiThinkingConfig('realtime'),
      responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: quizGenerationSchema } },
    }
    return JSON.stringify({ ...requestPayload, generationConfig })
  }

  const body = requestBodyForModel()
  let result = await requestQuizGeneration(apiKey, model, body, 1, 12_000)
  if (!result.response && fallbackModel && fallbackModel !== model && (result.failureStatus === null || retryableStatus(result.failureStatus))) {
    console.warn(`Gemini quiz generation unavailable on ${model}; retrying with ${fallbackModel}.`)
    result = await requestQuizGeneration(apiKey, fallbackModel, body, 1, 18_000)
  }
  if (!result.response) {
    const status = result.failureStatus ? ` (${result.failureStatus})` : ''
    throw new Error(`Gemini quiz generation failed${status}: ${result.failureMessage}`)
  }

  const response = result.response
  const outputText = extractGeminiText(await response.json())
  if (!outputText) throw new Error('Gemini returned no quiz.')
  const output = JSON.parse(outputText) as { title?: unknown; items?: unknown }
  if (!Array.isArray(output.items)) throw new Error('AI returned an invalid quiz item list.')
  if (output.items.length < 1 || output.items.length > 10) throw new Error('AI returned an unsupported question count.')
  if (input.requestedCount && output.items.length !== input.requestedCount) throw new Error('AI did not follow the requested question count.')

  const basePoints = Math.floor(100 / output.items.length)
  const remainder = 100 % output.items.length
  const items = output.items.map((raw, index) => {
    const item = raw as Record<string, unknown>
    const type = item.type as ItemType
    if (!itemTypes.has(type)) throw new Error(`AI returned an invalid type for item ${index + 1}.`)
    if (input.requestedType !== 'random' && type !== input.requestedType) throw new Error('AI did not follow the requested question type.')
    const promptText = typeof item.prompt_text === 'string' ? item.prompt_text.trim().slice(0, 2000) : ''
    if (!promptText) throw new Error(`Item ${index + 1} has no prompt.`)
    const options = cleanStrings(item.options, 6)
    const acceptedAnswers = cleanStrings(item.accepted_answers, 12)
    if (type === 'multiple_choice') {
      if (options.length < 2) throw new Error(`Item ${index + 1} needs at least two options.`)
      if (!acceptedAnswers.length || acceptedAnswers.some((answer) => !options.includes(answer))) {
        throw new Error(`Item ${index + 1} has an invalid answer key.`)
      }
    }
    if (type === 'fill_blank' && !acceptedAnswers.length) throw new Error(`Item ${index + 1} needs an accepted answer.`)
    const translation = (item.translation_en || {}) as Record<string, unknown>
    const translatedPrompt = typeof translation.prompt_text === 'string' ? translation.prompt_text.trim().slice(0, 2000) : ''
    const translatedOptions = cleanStrings(translation.options, 6)
    return {
      id: crypto.randomUUID(),
      position: index + 1,
      type,
      prompt_text: promptText,
      options: type === 'multiple_choice' ? options : [],
      points: basePoints + (index < remainder ? 1 : 0),
      translations: {
        en: {
          prompt_text: translatedPrompt || promptText,
          options: type === 'multiple_choice' && translatedOptions.length === options.length ? translatedOptions : options,
        },
      },
      accepted_answers: acceptedAnswers,
      rubric: typeof item.rubric === 'string' ? item.rubric.trim().slice(0, 2000) : '',
    }
  })

  return {
    title: typeof output.title === 'string' && output.title.trim()
      ? output.title.trim().slice(0, 200)
      : requestedLanguage === 'English' ? 'AI Custom Quiz' : 'AI 自訂測驗',
    items,
  }
}

export async function gradeCustomQuizAttempt(attemptId: string) {
  const supabase = getAdminClient()
  try {
    const { data: attempt, error: attemptError } = await supabase.from('quiz_attempts').select('*').eq('id', attemptId).single()
    if (attemptError || !attempt) throw attemptError || new Error('Quiz attempt not found.')
    const [{ data: items, error: itemError }, { data: answers, error: answerError }] = await Promise.all([
      supabase.from('quiz_items').select('*').eq('quiz_id', attempt.quiz_id).order('position'),
      supabase.from('quiz_item_answers').select('*').eq('attempt_id', attemptId),
    ])
    if (itemError || answerError || !items?.length) throw itemError || answerError || new Error('Quiz items are unavailable.')
    const itemIds = items.map((item) => item.id)
    const { data: keys, error: keyError } = await supabase.from('quiz_item_keys').select('*').in('item_id', itemIds)
    if (keyError || keys?.length !== items.length) throw keyError || new Error('Quiz keys are incomplete.')

    const keyByItem = new Map((keys || []).map((key) => [key.item_id, key]))
    const answerByItem = new Map((answers || []).map((answer) => [answer.item_id, answer]))
    const gradingInput = items.map((item) => {
      const key = keyByItem.get(item.id)
      const answer = answerByItem.get(item.id)
      return {
        item_id: item.id,
        type: item.type,
        prompt_text: item.prompt_text,
        options: item.options,
        points: item.points,
        accepted_answers: key?.accepted_answers || [],
        rubric: key?.rubric || '',
        submitted_answer: answer?.answer_values?.length ? answer.answer_values : answer?.answer_text || '',
      }
    })

    const aiGradingInput = gradingInput.filter((item) => item.type !== 'multiple_choice')
    let output: {
      evaluations?: Array<{ item_id?: string; score?: number; feedback_zh_tw?: string; feedback_en?: string }>
      overall_feedback_zh_tw?: string
      overall_feedback_en?: string
    } = { evaluations: [] }
    if (aiGradingInput.length) {
      const result = await callAiJson(
        '你是 InterAct 的形成性評量評分助理。依每題配分、參考答案與 rubric 評分。填充題接受語意相同且沒有概念錯誤的答案；簡答題依 rubric 給部分分。每題分數不得小於 0 或超過該題 points。以台灣繁體中文提供簡潔、具體且鼓勵性的回饋，並提供忠實英文翻譯。不得因文法或用字風格與參考答案不同而扣除內容正確答案的分數。',
        { items: aiGradingInput },
        gradingSchema,
        'realtime',
      )
      if (result.status !== 'success') throw new Error(String((result.output as { message?: string }).message || 'AI grading failed.'))
      output = result.output as typeof output
    }
    const evaluationByItem = new Map((output.evaluations || []).map((evaluation) => [evaluation.item_id, evaluation]))
    let totalScore = 0

    for (const item of items) {
      const answer = answerByItem.get(item.id)
      const key = keyByItem.get(item.id)
      if (!answer || !key) throw new Error('Quiz answer data is incomplete.')
      const evaluation = evaluationByItem.get(item.id)
      let score = 0
      let feedbackZhTw = ''
      let feedbackEn = ''
      if (item.type === 'multiple_choice') {
        const expected = [...new Set(key.accepted_answers || [])].sort()
        const submitted = [...new Set(answer.answer_values || [])].sort()
        const correct = expected.length === submitted.length && expected.every((value, index) => value === submitted[index])
        score = correct ? item.points : 0
        feedbackZhTw = correct ? '回答正確。' : `回答錯誤，正確答案：${expected.join('、')}`
        feedbackEn = correct ? 'Correct.' : `Incorrect. Correct answer: ${expected.join(', ')}`
      } else {
        if (!evaluation) throw new Error('AI grading result is incomplete.')
        score = Math.max(0, Math.min(item.points, Number(evaluation.score) || 0))
        feedbackZhTw = String(evaluation.feedback_zh_tw || '')
        feedbackEn = String(evaluation.feedback_en || '')
      }
      if (item.type === 'fill_blank') {
        const submitted = normalizedAnswer(answer.answer_text || '')
        if ((key.accepted_answers || []).some((value: string) => normalizedAnswer(value) === submitted)) score = item.points
      }
      score = Math.round(score * 100) / 100
      totalScore += score
      const { error } = await supabase.from('quiz_item_answers').update({
        score,
        feedback: {
          zh_tw: feedbackZhTw,
          en: feedbackEn,
        },
      }).eq('id', answer.id)
      if (error) throw error
    }

    totalScore = Math.round(totalScore * 100) / 100
    const overallFeedbackZhTw = aiGradingInput.length
      ? String(output.overall_feedback_zh_tw || '')
      : `本次選擇題得分 ${totalScore}/100。`
    const overallFeedbackEn = aiGradingInput.length
      ? String(output.overall_feedback_en || '')
      : `Multiple-choice score: ${totalScore}/100.`
    const { error: updateError } = await supabase.from('quiz_attempts').update({
      status: 'graded',
      total_score: totalScore,
      feedback: {
        zh_tw: overallFeedbackZhTw,
        en: overallFeedbackEn,
      },
      error_message: null,
      graded_at: new Date().toISOString(),
    }).eq('id', attemptId)
    if (updateError) throw updateError
    await supabase.from('answers').update({ answer_text: '[自訂測驗評分完成]' })
      .eq('question_id', attempt.question_id).eq('participant_id', attempt.participant_id)
  } catch (error) {
    const detail = errorDetail(error, 'AI grading failed.')
    console.error('custom quiz grading failed', detail)
    const supabase = getAdminClient()
    const { data: attempt } = await supabase.from('quiz_attempts').select('question_id, participant_id').eq('id', attemptId).maybeSingle()
    await supabase.from('quiz_attempts').update({
      status: 'failed',
      error_message: detail.slice(0, 1000),
      graded_at: new Date().toISOString(),
    }).eq('id', attemptId)
    if (attempt) {
      await supabase.from('answers').update({ answer_text: '[自訂測驗評分失敗]' })
        .eq('question_id', attempt.question_id).eq('participant_id', attempt.participant_id)
    }
  }
}
