import { callAiJson, corsHeaders, jsonResponse, parseThinkingLevel, errorDetail } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

const sessionAnalysisCoreSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executive_summary: { type: 'string' },
    lesson_key_points: { type: 'array', items: { type: 'string' } },
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
  required: ['executive_summary', 'lesson_key_points', 'engagement_analysis', 'learning_analysis', 'teaching_recommendations', 'limitations'],
}

const sessionAnalysisSchema = {
  ...sessionAnalysisCoreSchema,
  properties: {
    ...sessionAnalysisCoreSchema.properties,
    translations: {
      type: 'object',
      additionalProperties: false,
      properties: { en: sessionAnalysisCoreSchema },
      required: ['en'],
    },
  },
  required: [...sessionAnalysisCoreSchema.required, 'translations'],
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
    // An explicit thinking level means the presenter is retrying on purpose, so skip the cache.
    const thinkingLevel = parseThinkingLevel(input.thinkingLevel)
    const regenerate = input.regenerate === true || Boolean(thinkingLevel)

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
    if (!regenerate && cached?.input_json?.analysis_version === 9) {
      return jsonResponse({ analysis: cached.output_json, metrics: cached.input_json?.metrics, cached: true })
    }

    const [participantResult, messageResult, sharedContentResult, captionResult, questionResult, answerResult, audioResponseResult, fileResponseResult, questionAnalysisResult, exitTicketResult] = await Promise.all([
      supabase.from('participants').select('id').eq('session_id', sessionId).order('joined_at').limit(5000),
      supabase.from('messages').select('participant_id, content, created_at').eq('session_id', sessionId).order('created_at').limit(5000),
      supabase.from('shared_contents').select('body, url, created_at').eq('session_id', sessionId).order('created_at').limit(1000),
      supabase.from('caption_segments').select('language, source_language, text, is_translation, created_at').eq('session_id', sessionId).order('created_at').limit(10000),
      supabase.from('questions').select('*').eq('session_id', sessionId).order('created_at').limit(500),
      supabase.from('answers').select('question_id, participant_id, answer_value, answer_values, answer_text, is_correct').eq('session_id', sessionId).order('submitted_at').limit(10000),
      supabase.from('audio_responses').select('question_id, analysis_status, detected_language, transcript, score, analysis_json, submitted_at').eq('session_id', sessionId).order('submitted_at').limit(10000),
      supabase.from('file_responses').select('question_id, participant_id, name, mime_type, analysis_status, analysis_json, submitted_at').eq('session_id', sessionId).order('submitted_at').limit(10000),
      supabase.from('ai_summaries').select('question_id, output_json').eq('session_id', sessionId).eq('type', 'question_analysis').eq('status', 'success').order('created_at').limit(500),
      supabase.from('exit_tickets').select('most_useful, still_confused, understanding_score, engagement_score, next_suggestion, response_text, rating').eq('session_id', sessionId).order('submitted_at').limit(5000),
    ])

    for (const result of [participantResult, messageResult, sharedContentResult, captionResult, questionResult, answerResult, audioResponseResult, fileResponseResult, questionAnalysisResult, exitTicketResult]) {
      if (result.error) throw result.error
    }

    const participants = participantResult.data || []
    const messages = messageResult.data || []
    const sharedContents = sharedContentResult.data || []
    const captionSegments = captionResult.data || []
    const questions = questionResult.data || []
    const answers = answerResult.data || []
    const audioResponses = audioResponseResult.data || []
    // A student's pages carry one mark between them, so the submission — not
    // the file — is the unit everything below counts in.
    const fileResponses = fileResponseResult.data || []
    const fileSubmissions = [...fileResponses.reduce((byStudent, upload) => {
      const key = `${upload.question_id}:${upload.participant_id}`
      const kept = byStudent.get(key)
      const better = !kept
        || (kept.analysis_status !== 'success' && upload.analysis_status === 'success')
        || (kept.analysis_status === 'unsupported' && upload.analysis_status !== 'unsupported')
      if (better) byStudent.set(key, { ...upload, file_count: (kept?.file_count || 0) + 1 })
      else byStudent.set(key, { ...kept, file_count: kept.file_count + 1 })
      return byStudent
    }, new Map()).values()]
    const questionAnalyses = questionAnalysisResult.data || []
    const exitTickets = exitTicketResult.data || []
    const { data: quizzes, error: quizError } = await supabase.from('quizzes').select('*')
      .eq('session_id', sessionId).order('created_at').limit(500)
    if (quizError) throw quizError
    const quizIds = (quizzes || []).map((quiz) => quiz.id)
    const [{ data: quizItems, error: quizItemError }, { data: quizAttempts, error: quizAttemptError }] = quizIds.length
      ? await Promise.all([
        supabase.from('quiz_items').select('*').in('quiz_id', quizIds).order('position').limit(5000),
        supabase.from('quiz_attempts').select('*').eq('session_id', sessionId).in('quiz_id', quizIds).order('submitted_at').limit(10000),
      ])
      : [{ data: [], error: null }, { data: [], error: null }]
    if (quizItemError || quizAttemptError) throw quizItemError || quizAttemptError
    const quizItemIds = (quizItems || []).map((item) => item.id)
    const quizAttemptIds = (quizAttempts || []).map((attempt) => attempt.id)
    const [{ data: quizKeys, error: quizKeyError }, { data: quizItemAnswers, error: quizAnswerError }] = await Promise.all([
      quizItemIds.length ? supabase.from('quiz_item_keys').select('*').in('item_id', quizItemIds) : Promise.resolve({ data: [], error: null }),
      quizAttemptIds.length ? supabase.from('quiz_item_answers').select('*').in('attempt_id', quizAttemptIds).order('created_at').limit(50000) : Promise.resolve({ data: [], error: null }),
    ])
    if (quizKeyError || quizAnswerError) throw quizKeyError || quizAnswerError
    const interactiveQuestions = questions.filter((question) => question.type !== 'send_screen')
    const assessedAnswers = answers.filter((answer) => answer.is_correct !== null)
    const correctAnswers = assessedAnswers.filter((answer) => answer.is_correct)
    const submittedQuizAttempts = quizAttempts || []
    const scoredQuizItemAnswers = (quizItemAnswers || []).filter((answer) => typeof answer.score === 'number')
    const quizItemPoints = new Map((quizItems || []).map((item) => [item.id, Number(item.points) || 0]))
    const correctQuizItemAnswers = scoredQuizItemAnswers.filter((answer) => Number(answer.score) >= (quizItemPoints.get(answer.item_id) || 0))
    const durationEnd = new Date(endedAt).getTime()
    const durationMinutes = Math.max(0, Math.round((durationEnd - new Date(session.created_at).getTime()) / 60000))
    const averageResponseRate = participants.length && interactiveQuestions.length
      ? roundPercent(((answers.length + submittedQuizAttempts.length) / (participants.length * interactiveQuestions.length)) * 100)
      : 0

    const analysisByQuestion = new Map(questionAnalyses.map((item) => [item.question_id, item.output_json]))
    const quizByQuestion = new Map((quizzes || []).map((quiz) => [quiz.question_id, quiz]))
    const quizKeyByItem = new Map((quizKeys || []).map((key) => [key.item_id, key]))
    const questionResults = questions.map((question) => {
      const questionAnswers = answers.filter((answer) => answer.question_id === question.id)
      const distribution = Object.fromEntries(
        (Array.isArray(question.options) ? question.options : []).map((option: string) => [
          option,
          questionAnswers.filter((answer) => selectedValues(answer).includes(option)).length,
        ]),
      )
      const assessed = questionAnswers.filter((answer) => answer.is_correct !== null)
      const questionAudioResponses = audioResponses.filter((response) => response.question_id === question.id)
      const questionUploads = fileSubmissions.filter((upload) => upload.question_id === question.id)
      const quiz = quizByQuestion.get(question.id)
      const questionQuizItems = quiz ? (quizItems || []).filter((item) => item.quiz_id === quiz.id) : []
      const questionQuizAttempts = quiz ? (quizAttempts || []).filter((attempt) => attempt.quiz_id === quiz.id) : []
      const customQuiz = quiz ? {
        title: quiz.title,
        direction: quiz.direction,
        total_points: quiz.total_points,
        items: questionQuizItems.map((item) => {
          const key = quizKeyByItem.get(item.id)
          return {
            item_id: item.id,
            position: item.position,
            type: item.type,
            prompt_text: item.prompt_text,
            options: item.options,
            points: item.points,
            accepted_answers: key?.accepted_answers || [],
            rubric: key?.rubric || '',
          }
        }),
        attempts: questionQuizAttempts.slice(0, 500).map((attempt, index) => ({
          response_number: index + 1,
          status: attempt.status,
          total_score: attempt.total_score,
          max_score: attempt.max_score,
          overall_feedback: attempt.feedback,
          answers: (quizItemAnswers || []).filter((answer) => answer.attempt_id === attempt.id).map((answer) => ({
            item_id: answer.item_id,
            answer_text: answer.answer_text,
            answer_values: answer.answer_values,
            score: answer.score,
            feedback: answer.feedback,
          })),
        })),
      } : null
      const answerCount = quiz ? questionQuizAttempts.length : questionAnswers.length

      return {
        question_id: question.id,
        type: question.type,
        title: question.title,
        prompt_text: question.prompt_text,
        options: question.options,
        allow_multiple: question.allow_multiple,
        correct_answer: question.correct_answer,
        correct_answers: question.correct_answers,
        answer_count: answerCount,
        response_rate: participants.length ? roundPercent((answerCount / participants.length) * 100) : 0,
        correct_rate: assessed.length ? roundPercent((assessed.filter((answer) => answer.is_correct).length / assessed.length) * 100) : null,
        distribution,
        written_response_sample: questionAnswers.map((answer) => answer.answer_text).filter(Boolean).slice(0, 100),
        audio_evaluations: questionAudioResponses.map((response, index) => ({
          response_number: index + 1,
          analysis_status: response.analysis_status,
          detected_language: response.detected_language,
          transcript: response.transcript,
          score: response.score,
          analysis: response.analysis_json,
        })),
        // Written work the class handed in on paper. Only marked rows carry an
        // analysis; the unmarked ones are listed so the report can say plainly
        // how much of the class it is speaking for.
        file_submissions: questionUploads.map((upload, index) => ({
          response_number: index + 1,
          file_count: upload.file_count,
          analysis_status: upload.analysis_status,
          verdict: upload.analysis_json?.verdict ?? null,
          score: upload.analysis_json?.score ?? null,
          summary: upload.analysis_json?.summary_zh_tw ?? null,
          strengths: upload.analysis_json?.strengths_zh_tw ?? [],
          improvements: upload.analysis_json?.improvements_zh_tw ?? [],
        })),
        prior_ai_analysis: analysisByQuestion.get(question.id) || null,
        custom_quiz: customQuiz,
      }
    })

    const analyzedAudioResponses = audioResponses.filter((response) => response.analysis_status === 'success' && typeof response.score === 'number')
    const markedUploads = fileSubmissions.filter((upload) => upload.analysis_status === 'success' && typeof upload.analysis_json?.score === 'number')

    const metrics = {
      participant_count: participants.length,
      message_count: messages.length,
      active_message_participants: new Set(messages.map((message) => message.participant_id)).size,
      question_count: questions.length,
      interactive_question_count: interactiveQuestions.length,
      answer_count: answers.length + submittedQuizAttempts.length,
      average_response_rate: averageResponseRate,
      assessed_answer_count: assessedAnswers.length + scoredQuizItemAnswers.length,
      correct_answer_count: correctAnswers.length + correctQuizItemAnswers.length,
      correct_rate: assessedAnswers.length + scoredQuizItemAnswers.length
        ? roundPercent(((correctAnswers.length + correctQuizItemAnswers.length) / (assessedAnswers.length + scoredQuizItemAnswers.length)) * 100)
        : null,
      exit_ticket_count: exitTickets.length,
      audio_response_count: audioResponses.length,
      analyzed_audio_count: analyzedAudioResponses.length,
      average_audio_score: analyzedAudioResponses.length
        ? Math.round((analyzedAudioResponses.reduce((total, response) => total + response.score, 0) / analyzedAudioResponses.length) * 10) / 10
        : null,
      file_submission_count: fileSubmissions.length,
      file_count: fileResponses.length,
      marked_file_submission_count: markedUploads.length,
      average_file_score: markedUploads.length
        ? Math.round((markedUploads.reduce((total, upload) => total + upload.analysis_json.score, 0) / markedUploads.length) * 10) / 10
        : null,
      duration_minutes: durationMinutes,
    }

    summaryInput = {
      analysis_version: 9,
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
      lesson_transcript: captionSegments
        .filter((segment) => !segment.is_translation)
        .slice(-5000)
        .map((segment, index) => ({ number: index + 1, spoken_at: segment.created_at, language: segment.language, text: segment.text })),
      danmaku_content_sample: messages.slice(-500).map((message, index) => ({ number: index + 1, content: message.content })),
      exit_tickets: exitTickets.slice(0, 500).map((ticket, index) => ({ response_number: index + 1, ...ticket })),
    }

    const result = await callAiJson(
      '你是 InterAct 的課堂互動與形成性評量分析顧問。請先以繁體中文根據匿名化統計、講師派送的課程文字與連結、課堂原文逐字稿、彈幕內容、每題作答結果、錄音評測、既有題目分析與 Exit Ticket，產生可供講者課後使用的完整報告；再於 translations.en 輸出結構相同、證據與意義一致的自然英文版本。英文版本是翻譯，不可另行推論。lesson_transcript 是講師授課內容：若有內容，lesson_key_points 必須將整節課整理成精煉、具結構且可直接給教師與學生閱讀的課堂重點，不可逐句照抄、不可顯示逐字稿；若 lesson_transcript 為空，中英文 lesson_key_points 都必須回傳空陣列。逐字稿可用來核對互動脈絡與提出教學建議，但不可把講師說的話誤認為學生意見或學習證據。錄音題的 audio_evaluations 包含匿名化逐字稿、分數及個別 AI 評語，必須納入該題的 result_summary、evidence 與整體學習分析。上傳作答題的 file_submissions 是學生寫在紙上或做成檔案後上傳、再由 AI 逐份批改的結果，一位學生一筆（file_count 是他交了幾個檔）；判定與分數必須納入該題的 result_summary 與 evidence，analysis_status 不是 success 的代表尚未批改，只能算在未批改份數裡，不可當成沒作答，也不可臆測其內容。自訂測驗的 custom_quiz 包含題目、選項、正確答案、匿名化學生答案、得分與回饋，必須逐題分析其答題表現、錯誤與迷思，並納入對應的 question_findings；只要 attempts 有資料，就不可把該測驗判斷為無人作答。instructor_shared_contents 是講師提供的課程參考資料。所有結論都要指出資料證據；資料不足時必須寫入 limitations。不可推測學生身分，也不可把投票題當成對錯題。question_findings 的 question_id 必須原樣使用輸入中的 ID 以供系統對應，但不可在其他文字欄位中顯示或解釋 ID。',
      summaryInput,
      sessionAnalysisSchema,
      'deep',
      thinkingLevel,
    )
    if (result.status !== 'success') throw new Error(JSON.stringify(result.output).slice(0, 1000))
    if (!summaryInput.lesson_transcript.length) {
      result.output.lesson_key_points = []
      if (result.output.translations?.en) result.output.translations.en.lesson_key_points = []
    }

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
    const detail = errorDetail(error, 'Session analysis failed.')
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
