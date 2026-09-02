import { callAiJson, corsHeaders, jsonResponse, errorDetail } from '../_shared/ai.ts'
import { generateCustomQuiz } from '../_shared/custom-quiz.ts'
import { analyzeFileResponse, isAnalyzableFile } from '../_shared/file-analysis.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

type ParticipantRecord = { id: string; name: string }
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const questionTypes = new Set(['send_screen', 'poll', 'multiple_choice', 'true_false', 'short_answer', 'pronunciation', 'oral_response'])
const speakerLanguages = new Set(['zh-tw', 'en'])
const captionDisplayLanguages = new Set(['zh-tw', 'en', 'es', 'ja', 'ko', 'vi', 'de', 'id', 'th', 'fr'])
const interpretationLanguagesSupported = new Set(['zh-tw', 'en', 'es', 'ja', 'ko', 'vi', 'de', 'id', 'th', 'fr'])
const questionTranslationSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    prompt_text: { type: 'string' },
    options: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'prompt_text', 'options'],
}

async function translateQuestion(title: string, promptText: string, options: string[]) {
  if (!promptText && !options.length) return {}
  const result = await callAiJson(
    'Translate this instructor-authored classroom question into concise, natural English. Preserve names, numbers, formulas, meaning, option order, and the number of options exactly. Do not answer, explain, summarize, or add content. Return only the requested JSON.',
    { title, prompt_text: promptText, options },
    questionTranslationSchema,
    'realtime',
  )
  if (result.status !== 'success') return {}
  const translated = result.output as { title?: string; prompt_text?: string; options?: string[] }
  if (!Array.isArray(translated.options) || translated.options.length !== options.length) return {}
  return { en: translated }
}

function randomIndex(length: number) {
  if (length <= 1) return 0
  const ceiling = Math.floor(0x100000000 / length) * length
  const values = new Uint32Array(1)
  do crypto.getRandomValues(values)
  while (values[0] >= ceiling)
  return values[0] % length
}

function shuffled<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1)
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }
  return copy
}

function normalizedUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
  const parsed = new URL(candidate)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS links are supported.')
  return parsed.toString().slice(0, 2048)
}

function validUuid(value: unknown) {
  return typeof value === 'string' && uuidPattern.test(value)
}

const MAX_TRANSFER_BYTES = 200 * 1024 * 1024

// Storage keys must stay ASCII-safe; the original name is kept in the database.
function storageSafeName(name: string) {
  // Keep the extension: a fully non-ASCII name would otherwise collapse to nothing
  // and the browser would save the download with no extension at all.
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toLowerCase() : ''
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(-60)
  return `${stem || 'file'}${ext ? `.${ext}` : ''}`
}

function withFileUrl<T extends { storage_path?: string }>(row: T) {
  const base = Deno.env.get('SUPABASE_URL') || ''
  if (!row?.storage_path || !base) return row
  return { ...row, file_url: `${base}/storage/v1/object/public/interact-files/${row.storage_path}` }
}

function normalizedOptions(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((option): option is string => typeof option === 'string')
    .map((option) => option.trim().slice(0, 500))
    .filter(Boolean))]
    .slice(0, 20)
}

async function listStorageFiles(
  supabase: ReturnType<typeof getAdminClient>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const files: string[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000, offset })
    if (error) throw error
    for (const item of data || []) {
      const path = `${prefix}/${item.name}`
      if (item.id) files.push(path)
      else files.push(...await listStorageFiles(supabase, bucket, path))
    }
    if (!data || data.length < 1000) break
  }
  return files
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const input = await req.json()
    const action = typeof input.action === 'string' ? input.action : ''
    const supabase = getAdminClient()

    if (action === 'list_sessions') {
      const credentials: Array<{ sessionId: string; presenterToken: string }> = Array.isArray(input.credentials)
        ? input.credentials
          .map((credential: unknown) => {
            if (!credential || typeof credential !== 'object') return null
            const candidate = credential as Record<string, unknown>
            if (typeof candidate.sessionId !== 'string' || typeof candidate.presenterToken !== 'string') return null
            return { sessionId: candidate.sessionId, presenterToken: candidate.presenterToken }
          })
          .filter((credential: { sessionId: string; presenterToken: string } | null): credential is { sessionId: string; presenterToken: string } => Boolean(credential))
          .slice(0, 100)
        : []
      if (!credentials.length) return jsonResponse({ sessions: [] })

      const tokenBySession = new Map<string, string>()
      for (const credential of credentials) {
        tokenBySession.set(credential.sessionId, await hashPresenterToken(credential.presenterToken))
      }
      const sessionIds = [...tokenBySession.keys()]
      const { data: keyRecords, error: keyError } = await supabase
        .from('presenter_session_keys')
        .select('session_id, token_hash')
        .in('session_id', sessionIds)
      if (keyError) throw keyError

      const verifiedIds = (keyRecords || [])
        .filter((record) => tokenBySession.get(record.session_id) === record.token_hash)
        .map((record) => record.session_id)
      if (!verifiedIds.length) return jsonResponse({ sessions: [] })

      const { data: sessions, error: sessionError } = await supabase
        .from('sessions')
        .select('id, title, code, status, created_at, ended_at')
        .in('id', verifiedIds)
        .order('created_at', { ascending: false })
      if (sessionError) throw sessionError
      return jsonResponse({ sessions: sessions || [] })
    }

    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const presenterToken = typeof input.presenterToken === 'string' ? input.presenterToken : ''
    if (!sessionId || !presenterToken || !action) return jsonResponse({ message: '缺少講者操作所需資料。' }, 400)

    const tokenHash = await hashPresenterToken(presenterToken)
    const { data: keyRecord } = await supabase
      .from('presenter_session_keys')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (!keyRecord) return jsonResponse({ message: '講者權限驗證失敗。' }, 403)

    if (action === 'update_session') {
      const values: Record<string, boolean | number | string | string[] | null> = {}
      if (typeof input.danmakuEnabled === 'boolean') values.danmaku_enabled = input.danmakuEnabled
      if (typeof input.anonymousEnabled === 'boolean') values.anonymous_enabled = input.anonymousEnabled
      if (typeof input.recordingEnabled === 'boolean') {
        values.recording_enabled = input.recordingEnabled
        if (!input.recordingEnabled) values.captions_enabled = false
      }
      if (typeof input.captionsEnabled === 'boolean') {
        values.captions_enabled = input.captionsEnabled
      }
      if (input.recordingEnabled === true) values.caption_started_at = new Date().toISOString()
      if (['idle', 'starting', 'live', 'error'].includes(input.captionStatus)) values.caption_status = input.captionStatus
      const hasCaptionConfiguration = [
        input.captionSourceLanguage,
        input.captionDisplayLanguage,
        input.captionFontSize,
        input.captionFontBold,
        input.captionPosition,
        input.interpretationAudioEnabled,
        input.interpretationLanguages,
      ].some((value) => value !== undefined)
      if (hasCaptionConfiguration) {
        const sourceLanguage = typeof input.captionSourceLanguage === 'string'
          ? input.captionSourceLanguage.trim().toLowerCase()
          : ''
        if (!speakerLanguages.has(sourceLanguage)) return jsonResponse({ message: '講師字幕語言不支援。' }, 400)
        const displayLanguage = typeof input.captionDisplayLanguage === 'string'
          ? input.captionDisplayLanguage.trim().toLowerCase()
          : ''
        if (!captionDisplayLanguages.has(displayLanguage)) return jsonResponse({ message: '字幕顯示語言不支援。' }, 400)
        const interpretationLanguages: string[] = Array.isArray(input.interpretationLanguages)
          ? [...new Set((input.interpretationLanguages as unknown[]).filter((language: unknown): language is string => (
            typeof language === 'string' && interpretationLanguagesSupported.has(language) && language !== sourceLanguage
          )))]
          : []
        const interpretationAudioEnabled = Boolean(input.interpretationAudioEnabled) && interpretationLanguages.length > 0
        values.caption_source_language = sourceLanguage
        values.caption_display_language = displayLanguage
        if (input.captionFontSize !== undefined) {
          const captionFontSize = Number(input.captionFontSize)
          if (!Number.isInteger(captionFontSize) || captionFontSize < 24 || captionFontSize > 96) {
            return jsonResponse({ message: '字幕字型大小不正確。' }, 400)
          }
          values.caption_font_size = captionFontSize
        }
        if (typeof input.captionFontBold === 'boolean') values.caption_font_bold = input.captionFontBold
        if (input.captionPosition !== undefined) {
          const captionPosition = typeof input.captionPosition === 'string' ? input.captionPosition : ''
          if (!['top', 'center', 'bottom'].includes(captionPosition)) {
            return jsonResponse({ message: '字幕位置不正確。' }, 400)
          }
          values.caption_position = captionPosition
        }
        values.interpretation_enabled = interpretationAudioEnabled
        values.interpretation_audio_enabled = interpretationAudioEnabled
        values.interpretation_languages = interpretationAudioEnabled ? interpretationLanguages : []
      }
      if (!Object.keys(values).length) return jsonResponse({ message: '沒有可更新的場次設定。' }, 400)

      const { data, error } = await supabase
        .from('sessions')
        .update(values)
        .eq('id', sessionId)
        .eq('status', 'active')
        .select('*')
        .maybeSingle()
      if (error) throw error
      if (!data) return jsonResponse({ message: '場次已結束，無法變更設定。' }, 409)
      return jsonResponse({ session: data })
    }

    if (action === 'append_caption') {
      const segmentId = validUuid(input.segmentId) ? input.segmentId : crypto.randomUUID()
      const text = typeof input.text === 'string' ? input.text.trim().slice(0, 4000) : ''
      const language = typeof input.language === 'string' ? input.language.trim().toLowerCase().slice(0, 20) : ''
      const sourceLanguage = typeof input.sourceLanguage === 'string' ? input.sourceLanguage.trim().toLowerCase().slice(0, 20) : ''
      if (!text || !language || !sourceLanguage) return jsonResponse({ message: '字幕內容不完整。' }, 400)

      const { data, error } = await supabase
        .from('caption_segments')
        .upsert({
          id: segmentId,
          session_id: sessionId,
          language,
          source_language: sourceLanguage,
          text,
          is_translation: language !== sourceLanguage,
          started_at: typeof input.startedAt === 'string' ? input.startedAt : null,
          ended_at: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select('*')
        .single()
      if (error) throw error
      return jsonResponse({ segment: data })
    }


    if (action === 'prepare_shared_file_upload') {
      const fileName = typeof input.fileName === 'string' ? input.fileName.trim().slice(0, 200) : ''
      const fileSize = Number(input.fileSize)
      if (!fileName || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_TRANSFER_BYTES) {
        return jsonResponse({ message: '檔案資料不正確，單檔上限 200 MB。' }, 400)
      }
      const fileId = crypto.randomUUID()
      const storagePath = `sessions/${sessionId}/files/shared/${fileId}/${storageSafeName(fileName)}`
      const { data, error } = await supabase.storage.from('interact-files').createSignedUploadUrl(storagePath)
      if (error) throw error
      return jsonResponse({ fileId, storagePath, uploadToken: data.token })
    }

    if (action === 'submit_shared_file') {
      const storagePath = typeof input.storagePath === 'string' ? input.storagePath : ''
      const fileName = typeof input.fileName === 'string' ? input.fileName.trim().slice(0, 200) : ''
      const mimeType = typeof input.mimeType === 'string' && input.mimeType.trim()
        ? input.mimeType.trim().slice(0, 150)
        : 'application/octet-stream'
      const fileSize = Number(input.fileSize)
      if (!fileName || !storagePath.startsWith(`sessions/${sessionId}/files/shared/`)
        || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_TRANSFER_BYTES) {
        return jsonResponse({ message: '檔案資料不正確。' }, 400)
      }
      const { data, error } = await supabase.from('shared_files').insert({
        session_id: sessionId,
        name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
        storage_path: storagePath,
      }).select('*').single()
      if (error) throw error
      return jsonResponse({ file: withFileUrl(data) })
    }

    if (action === 'list_shared_files') {
      const { data, error } = await supabase.from('shared_files')
        .select('*').eq('session_id', sessionId).order('created_at')
      if (error) throw error
      return jsonResponse({ files: (data || []).map(withFileUrl) })
    }

    if (action === 'delete_shared_file') {
      const fileId = input.fileId
      if (!validUuid(fileId)) return jsonResponse({ message: '檔案資料不正確。' }, 400)
      const { data: file, error: findError } = await supabase.from('shared_files')
        .select('storage_path').eq('id', fileId).eq('session_id', sessionId).maybeSingle()
      if (findError) throw findError
      if (!file) return jsonResponse({ message: '找不到檔案。' }, 404)
      const { error: storageError } = await supabase.storage.from('interact-files').remove([file.storage_path])
      if (storageError) throw storageError
      const { error: deleteError } = await supabase.from('shared_files').delete().eq('id', fileId)
      if (deleteError) throw deleteError
      return jsonResponse({ deleted: true })
    }

    if (action === 'create_file_request') {
      const promptText = typeof input.promptText === 'string' ? input.promptText.trim().slice(0, 1000) : ''
      const { data: question, error } = await supabase.from('questions').insert({
        session_id: sessionId,
        type: 'file_upload',
        status: 'active',
        title: '檔案上傳',
        prompt_text: promptText || null,
      }).select('*').single()
      if (error) throw error
      const { error: sessionError } = await supabase.from('sessions')
        .update({ current_question_id: question.id }).eq('id', sessionId)
      if (sessionError) throw sessionError
      return jsonResponse({ question })
    }

    if (action === 'get_file_responses') {
      // The report wants every upload in the session, the modal wants one question.
      const questionId = typeof input.questionId === 'string' ? input.questionId : ''
      if (questionId && !validUuid(questionId)) return jsonResponse({ message: '題目資料不正確。' }, 400)
      let fileQuery = supabase.from('file_responses')
        .select('*').eq('session_id', sessionId)
      if (questionId) fileQuery = fileQuery.eq('question_id', questionId)
      const { data, error } = await fileQuery.order('submitted_at')
      if (error) throw error
      return jsonResponse({ responses: (data || []).map(withFileUrl) })
    }

    // Analysis is per file and only ever runs when the presenter asks for it.
    if (action === 'analyze_file_response') {
      const responseId = input.responseId
      if (!validUuid(responseId)) return jsonResponse({ message: '檔案資料不正確。' }, 400)
      const { data: fileRow, error: findError } = await supabase.from('file_responses')
        .select('*').eq('id', responseId).eq('session_id', sessionId).maybeSingle()
      if (findError) throw findError
      if (!fileRow) return jsonResponse({ message: '找不到這個檔案。' }, 404)
      if (!isAnalyzableFile(fileRow.mime_type, fileRow.name)) {
        const { data: skipped } = await supabase.from('file_responses')
          .update({ analysis_status: 'unsupported', error_message: 'AI 無法讀取這個檔案格式。', analyzed_at: new Date().toISOString() })
          .eq('id', responseId).select('*').single()
        return jsonResponse({ response: withFileUrl(skipped) })
      }

      await supabase.from('file_responses').update({ analysis_status: 'analyzing', error_message: null }).eq('id', responseId)
      try {
        const { data: question } = await supabase.from('questions')
          .select('prompt_text').eq('id', fileRow.question_id).maybeSingle()
        const { data: blob, error: downloadError } = await supabase.storage
          .from('interact-files').download(fileRow.storage_path)
        if (downloadError) throw downloadError
        const analysis = await analyzeFileResponse({
          promptText: question?.prompt_text || null,
          fileName: fileRow.name,
          mimeType: fileRow.mime_type,
          fileBytes: new Uint8Array(await blob.arrayBuffer()),
        })
        const { data: updated, error: updateError } = await supabase.from('file_responses').update({
          analysis_status: 'success',
          analysis_json: analysis,
          error_message: null,
          analyzed_at: new Date().toISOString(),
        }).eq('id', responseId).select('*').single()
        if (updateError) throw updateError
        return jsonResponse({ response: withFileUrl(updated) })
      } catch (analysisError) {
        const detail = errorDetail(analysisError, 'AI 分析失敗。')
        const { data: failed } = await supabase.from('file_responses').update({
          analysis_status: 'failed',
          error_message: detail.slice(0, 500),
          analyzed_at: new Date().toISOString(),
        }).eq('id', responseId).select('*').single()
        return jsonResponse({ response: withFileUrl(failed), message: detail.slice(0, 500) }, 200)
      }
    }
    if (action === 'prepare_screenshot_upload') {
      const screenshotId = crypto.randomUUID()
      const extension = typeof input.fileName === 'string'
        ? input.fileName.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1] || 'png'
        : 'png'
      const normalizedExtension = extension === 'jpeg' ? 'jpg' : extension
      const storagePath = `sessions/${sessionId}/screenshots/${screenshotId}.${normalizedExtension}`
      const { data, error } = await supabase.storage
        .from('interact-screenshots')
        .createSignedUploadUrl(storagePath)
      if (error) throw error
      return jsonResponse({
        screenshotId,
        storagePath,
        uploadToken: data.token,
      })
    }

    if (action === 'create_custom_quiz') {
      const screenshotId = input.screenshotId
      const storagePath = typeof input.storagePath === 'string' ? input.storagePath : ''
      const direction = typeof input.direction === 'string' ? input.direction.trim().slice(0, 2000) : ''
      const requestedCountValue = input.requestedCount === null || input.requestedCount === '' || input.requestedCount === undefined
        ? null
        : Number(input.requestedCount)
      const requestedCount = typeof requestedCountValue === 'number' && Number.isInteger(requestedCountValue) && requestedCountValue >= 1 && requestedCountValue <= 10
        ? requestedCountValue
        : null
      const requestedType = typeof input.requestedType === 'string' ? input.requestedType : 'random'
      // A quiz can be built from a screenshot or from a file the teacher shared;
      // the two differ only in where the source comes from and whether a
      // screenshot row is recorded alongside it.
      const sharedFileId = input.sharedFileId
      const fromSharedFile = sharedFileId !== undefined && sharedFileId !== null && sharedFileId !== ''
      if (fromSharedFile && !validUuid(sharedFileId)) return jsonResponse({ message: '檔案資料不正確。' }, 400)
      if (!fromSharedFile && !validUuid(screenshotId)) return jsonResponse({ message: '請提供有效的截圖與出題方向。' }, 400)
      if (!direction) return jsonResponse({ message: '請提供有效的截圖與出題方向。' }, 400)
      if (!['random', 'multiple_choice', 'fill_blank', 'short_answer'].includes(requestedType)) {
        return jsonResponse({ message: '測驗題型設定不正確。' }, 400)
      }
      if (input.requestedCount !== null && input.requestedCount !== '' && input.requestedCount !== undefined && requestedCount === null) {
        return jsonResponse({ message: '題數必須介於 1 到 10 題。' }, 400)
      }
      let sourceUrl = ''
      if (fromSharedFile) {
        const { data: sharedFile, error: sharedFileError } = await supabase.from('shared_files')
          .select('*').eq('id', sharedFileId).eq('session_id', sessionId).maybeSingle()
        if (sharedFileError) throw sharedFileError
        if (!sharedFile) return jsonResponse({ message: '找不到這個檔案。' }, 404)
        if (!isAnalyzableFile(sharedFile.mime_type, sharedFile.name)) {
          return jsonResponse({ message: 'AI 無法讀取這個檔案格式，無法用來出題。' }, 400)
        }
        const { data: fileUrlData } = supabase.storage.from('interact-files').getPublicUrl(sharedFile.storage_path)
        sourceUrl = fileUrlData.publicUrl
      } else {
        if (storagePath !== `sessions/${sessionId}/screenshots/${screenshotId}.${storagePath.split('.').at(-1)}` ||
            !/\.(png|jpg|webp)$/.test(storagePath)) {
          return jsonResponse({ message: '截圖路徑不正確。' }, 400)
        }

        const { data: objectList, error: objectError } = await supabase.storage
          .from('interact-screenshots')
          .list(`sessions/${sessionId}/screenshots`, { search: `${screenshotId}.`, limit: 2 })
        if (objectError) throw objectError
        if (!objectList?.some((object) => storagePath.endsWith(`/${object.name}`))) {
          return jsonResponse({ message: '找不到已上傳的截圖。' }, 400)
        }

        const { data: publicData } = supabase.storage.from('interact-screenshots').getPublicUrl(storagePath)
        sourceUrl = publicData.publicUrl
      }

      const stoppedAt = new Date().toISOString()
      const { error: stopError } = await supabase.from('questions')
        .update({ status: 'stopped', stopped_at: stoppedAt })
        .eq('session_id', sessionId).eq('status', 'active')
      if (stopError) throw stopError

      // Only a screenshot-sourced quiz has a screenshot to record; a file-sourced
      // one leaves screenshot_id null, which the result view already allows for.
      if (!fromSharedFile) {
        const { error: screenshotError } = await supabase.from('screenshots').insert({
          id: screenshotId,
          session_id: sessionId,
          storage_path: storagePath,
          public_url: sourceUrl,
          ai_status: 'pending',
        })
        if (screenshotError) throw screenshotError
      }

      const questionId = crypto.randomUUID()
      const quizId = crypto.randomUUID()
      const { data: pendingQuestion, error: questionError } = await supabase.from('questions').insert({
        id: questionId,
        session_id: sessionId,
        screenshot_id: fromSharedFile ? null : screenshotId,
        type: 'custom_quiz',
        status: 'active',
        title: '出題中，請稍候',
        prompt_text: direction,
        options: [],
        translations: { en: { title: 'Preparing questions, please wait', prompt_text: direction, options: [] } },
        allow_multiple: false,
      }).select('*').single()
      if (questionError) throw questionError

      const { error: sessionError } = await supabase.from('sessions')
        .update({ current_question_id: questionId }).eq('id', sessionId).eq('status', 'active')
      if (sessionError) throw sessionError

      const generateInBackground = async () => {
        try {
          const generated = await generateCustomQuiz({
            sourceUrl,
            direction,
            requestedCount,
            requestedType: requestedType as 'random' | 'multiple_choice' | 'fill_blank' | 'short_answer',
          })

          if (!fromSharedFile) {
            const { error: screenshotUpdateError } = await supabase.from('screenshots').update({
              ai_status: 'success',
              screen_summary: { quiz_title: generated.title, item_count: generated.items.length },
            }).eq('id', screenshotId)
            if (screenshotUpdateError) throw screenshotUpdateError
          }

          const { error: quizError } = await supabase.from('quizzes').insert({
            id: quizId,
            session_id: sessionId,
            question_id: questionId,
            title: generated.title,
            direction,
            requested_count: requestedCount,
            requested_type: requestedType,
          })
          if (quizError) throw quizError

          const { error: itemError } = await supabase.from('quiz_items').insert(generated.items.map((item) => ({
            id: item.id,
            quiz_id: quizId,
            position: item.position,
            type: item.type,
            prompt_text: item.prompt_text,
            options: item.options,
            points: item.points,
            translations: item.translations,
          })))
          if (itemError) throw itemError

          const { error: keyError } = await supabase.from('quiz_item_keys').insert(generated.items.map((item) => ({
            item_id: item.id,
            accepted_answers: item.accepted_answers,
            rubric: item.rubric,
          })))
          if (keyError) throw keyError

          const { error: questionUpdateError } = await supabase.from('questions').update({
            title: generated.title,
            translations: { en: { title: 'AI custom quiz', prompt_text: direction, options: [] } },
          }).eq('id', questionId)
          if (questionUpdateError) throw questionUpdateError
        } catch (error) {
          const detail = errorDetail(error, 'AI quiz generation failed.')
          console.error('custom quiz generation failed', detail)
          await Promise.all([
            fromSharedFile ? Promise.resolve() : supabase.from('screenshots').update({
              ai_status: 'failed',
              screen_summary: { error: detail.slice(0, 500) },
            }).eq('id', screenshotId),
            supabase.from('questions').update({
              title: '出題失敗，請重新派送',
              translations: { en: { title: 'Question generation failed. Please send it again.', prompt_text: direction, options: [] } },
            }).eq('id', questionId),
          ])
        }
      }

      EdgeRuntime.waitUntil(generateInBackground())
      return jsonResponse({ question: pendingQuestion, quizId, generating: true }, 202)
    }

    if (action === 'get_session_custom_quiz_results') {
      const { data: quizzes, error: quizError } = await supabase.from('quizzes').select('*')
        .eq('session_id', sessionId).order('created_at')
      if (quizError) throw quizError

      const quizIds = (quizzes || []).map((quiz) => quiz.id)
      if (!quizIds.length) {
        return jsonResponse({ quizzes: [], items: [], attempts: [], answers: [], keys: [] })
      }

      const [{ data: items, error: itemError }, { data: attempts, error: attemptError }] = await Promise.all([
        supabase.from('quiz_items').select('*').in('quiz_id', quizIds).order('position'),
        supabase.from('quiz_attempts').select('*').eq('session_id', sessionId).in('quiz_id', quizIds).order('submitted_at'),
      ])
      if (itemError || attemptError) throw itemError || attemptError

      const itemIds = (items || []).map((item) => item.id)
      const attemptIds = (attempts || []).map((attempt) => attempt.id)
      const [{ data: keys, error: keyError }, { data: answers, error: answerError }] = await Promise.all([
        itemIds.length ? supabase.from('quiz_item_keys').select('*').in('item_id', itemIds) : Promise.resolve({ data: [], error: null }),
        attemptIds.length ? supabase.from('quiz_item_answers').select('*').in('attempt_id', attemptIds).order('created_at') : Promise.resolve({ data: [], error: null }),
      ])
      if (keyError || answerError) throw keyError || answerError

      return jsonResponse({
        quizzes: quizzes || [],
        items: items || [],
        attempts: attempts || [],
        answers: answers || [],
        keys: keys || [],
      })
    }

    if (action === 'get_custom_quiz_results') {
      const questionId = input.questionId
      if (!validUuid(questionId)) return jsonResponse({ message: '測驗資料格式不正確。' }, 400)
      const { data: quiz, error: quizError } = await supabase.from('quizzes').select('*')
        .eq('question_id', questionId).eq('session_id', sessionId).maybeSingle()
      if (quizError) throw quizError
      if (!quiz) {
        const { data: pendingQuestion, error: pendingError } = await supabase.from('questions').select('title')
          .eq('id', questionId).eq('session_id', sessionId).maybeSingle()
        if (pendingError) throw pendingError
        if (pendingQuestion?.title === '出題失敗，請重新派送') {
          return jsonResponse({ message: 'AI 出題暫時失敗，請重新派送。', generating: false }, 503)
        }
        if (pendingQuestion) {
          return jsonResponse({ generating: true, quiz: null, items: [], attempts: [], answers: [], keys: [], screenshot: null }, 202)
        }
        return jsonResponse({ message: '找不到自訂測驗。' }, 404)
      }
      const [{ data: items, error: itemError }, { data: attempts, error: attemptError }, { data: question, error: questionError }] = await Promise.all([
        supabase.from('quiz_items').select('*').eq('quiz_id', quiz.id).order('position'),
        supabase.from('quiz_attempts').select('*').eq('quiz_id', quiz.id).order('submitted_at'),
        supabase.from('questions').select('screenshot_id').eq('id', questionId).eq('session_id', sessionId).single(),
      ])
      if (itemError || attemptError || questionError) throw itemError || attemptError || questionError
      const itemIds = (items || []).map((item) => item.id)
      const attemptIds = (attempts || []).map((attempt) => attempt.id)
      const [{ data: keys, error: keyError }, { data: answers, error: answerError }, { data: screenshot, error: screenshotError }] = await Promise.all([
        itemIds.length ? supabase.from('quiz_item_keys').select('*').in('item_id', itemIds) : Promise.resolve({ data: [], error: null }),
        attemptIds.length ? supabase.from('quiz_item_answers').select('*').in('attempt_id', attemptIds) : Promise.resolve({ data: [], error: null }),
        question.screenshot_id
          ? supabase.from('screenshots').select('*').eq('id', question.screenshot_id).maybeSingle()
          : Promise.resolve({ data: null, error: null }),
      ])
      if (keyError || answerError || screenshotError) throw keyError || answerError || screenshotError
      return jsonResponse({ quiz, items: items || [], attempts: attempts || [], answers: answers || [], keys: keys || [], screenshot: screenshot || null })
    }

    if (action === 'update_custom_quiz_key') {
      const questionId = input.questionId
      const itemId = input.itemId
      const acceptedAnswers = normalizedOptions(input.acceptedAnswers).slice(0, 12)
      if (!validUuid(questionId) || !validUuid(itemId) || !acceptedAnswers.length) {
        return jsonResponse({ message: '請提供有效的題目與正確答案。' }, 400)
      }
      const { data: quiz, error: quizError } = await supabase.from('quizzes').select('id')
        .eq('question_id', questionId).eq('session_id', sessionId).maybeSingle()
      if (quizError) throw quizError
      if (!quiz) return jsonResponse({ message: '找不到自訂測驗。' }, 404)
      const { data: item, error: itemError } = await supabase.from('quiz_items').select('*')
        .eq('id', itemId).eq('quiz_id', quiz.id).maybeSingle()
      if (itemError) throw itemError
      if (!item) return jsonResponse({ message: '找不到測驗題目。' }, 404)
      if (item.type === 'multiple_choice' && (acceptedAnswers.length !== 1 || !item.options.includes(acceptedAnswers[0]))) {
        return jsonResponse({ message: '正確答案必須是題目中的一個選項。' }, 400)
      }
      const { error: keyError } = await supabase.from('quiz_item_keys')
        .update({ accepted_answers: acceptedAnswers }).eq('item_id', itemId)
      if (keyError) throw keyError

      if (item.type === 'multiple_choice') {
        const [{ data: itemAnswers, error: answerError }, { data: quizItems, error: quizItemsError }] = await Promise.all([
          supabase.from('quiz_item_answers').select('id, attempt_id, answer_values').eq('item_id', itemId),
          supabase.from('quiz_items').select('type').eq('quiz_id', quiz.id),
        ])
        if (answerError || quizItemsError) throw answerError || quizItemsError
        const isChoiceOnlyQuiz = Boolean(quizItems?.length) && quizItems.every((quizItem) => quizItem.type === 'multiple_choice')
        const affectedAttemptIds = new Set<string>()
        for (const answer of itemAnswers || []) {
          const submitted = Array.isArray(answer.answer_values) ? [...new Set(answer.answer_values)].sort() : []
          const expected = [...acceptedAnswers].sort()
          const correct = submitted.length === expected.length && expected.every((value, index) => value === submitted[index])
          const { error } = await supabase.from('quiz_item_answers').update({
            score: correct ? item.points : 0,
            feedback: {
              zh_tw: correct ? '回答正確。' : `回答錯誤，正確答案：${expected.join('、')}`,
              en: correct ? 'Correct.' : `Incorrect. Correct answer: ${expected.join(', ')}`,
            },
          }).eq('id', answer.id)
          if (error) throw error
          affectedAttemptIds.add(answer.attempt_id)
        }
        for (const attemptId of affectedAttemptIds) {
          const { data: scoredAnswers, error: scoreError } = await supabase.from('quiz_item_answers')
            .select('score').eq('attempt_id', attemptId)
          if (scoreError) throw scoreError
          const totalScore = Math.round((scoredAnswers || []).reduce((sum, answer) => sum + (Number(answer.score) || 0), 0) * 100) / 100
          const values: Record<string, unknown> = { total_score: totalScore }
          if (isChoiceOnlyQuiz) {
            values.feedback = {
              zh_tw: `本次選擇題得分 ${totalScore}/100。`,
              en: `Multiple-choice score: ${totalScore}/100.`,
            }
          }
          const { error } = await supabase.from('quiz_attempts').update(values).eq('id', attemptId)
          if (error) throw error
        }
      }
      return jsonResponse({ success: true })
    }

    if (action === 'create_question') {
      const screenshotId = input.screenshotId
      const storagePath = typeof input.storagePath === 'string' ? input.storagePath : ''
      const type = typeof input.questionType === 'string' ? input.questionType : ''
      if (!validUuid(screenshotId) || !questionTypes.has(type)) {
        return jsonResponse({ message: '題目資料格式不正確。' }, 400)
      }
      if (storagePath !== `sessions/${sessionId}/screenshots/${screenshotId}.${storagePath.split('.').at(-1)}` ||
          !/\.(png|jpg|webp)$/.test(storagePath)) {
        return jsonResponse({ message: '截圖路徑不正確。' }, 400)
      }

      const options = normalizedOptions(input.options)
      const allowMultiple = Boolean(input.allowMultiple) && ['poll', 'multiple_choice'].includes(type)
      const promptText = typeof input.promptText === 'string' ? input.promptText.trim().slice(0, 1000) : ''
      const titles: Record<string, string> = {
        send_screen: '派送畫面',
        poll: '投票題',
        multiple_choice: '選擇題',
        true_false: '是非題',
        short_answer: '問答題',
        pronunciation: '朗讀發音',
        oral_response: '口語表達',
      }
      let translations = {}
      try {
        translations = await translateQuestion(titles[type], promptText, options)
      } catch (translationError) {
        console.error('question translation failed', translationError instanceof Error ? translationError.message : translationError)
      }
      const { data: objectList, error: objectError } = await supabase.storage
        .from('interact-screenshots')
        .list(`sessions/${sessionId}/screenshots`, { search: `${screenshotId}.`, limit: 2 })
      if (objectError) throw objectError
      if (!objectList?.some((object) => storagePath.endsWith(`/${object.name}`))) {
        return jsonResponse({ message: '找不到已上傳的截圖。' }, 400)
      }

      const stoppedAt = new Date().toISOString()
      const { error: stopError } = await supabase
        .from('questions')
        .update({ status: 'stopped', stopped_at: stoppedAt })
        .eq('session_id', sessionId)
        .eq('status', 'active')
      if (stopError) throw stopError

      const { data: publicData } = supabase.storage.from('interact-screenshots').getPublicUrl(storagePath)
      const { error: screenshotError } = await supabase
        .from('screenshots')
        .insert({
          id: screenshotId,
          session_id: sessionId,
          storage_path: storagePath,
          public_url: publicData.publicUrl,
          ai_status: 'skipped',
        })
      if (screenshotError) throw screenshotError

      const { data: question, error: questionError } = await supabase
        .from('questions')
        .insert({
          session_id: sessionId,
          screenshot_id: screenshotId,
          type,
          status: 'active',
          title: titles[type],
          prompt_text: promptText || null,
          options,
          translations,
          allow_multiple: allowMultiple,
        })
        .select('*')
        .single()
      if (questionError) throw questionError

      const { error: sessionError } = await supabase
        .from('sessions')
        .update({ current_question_id: question.id })
        .eq('id', sessionId)
        .eq('status', 'active')
      if (sessionError) throw sessionError
      return jsonResponse({ question })
    }

    if (action === 'stop_question') {
      const questionId = input.questionId
      if (!validUuid(questionId)) return jsonResponse({ message: '題目資料格式不正確。' }, 400)
      const { data, error } = await supabase
        .from('questions')
        .update({ status: 'stopped', stopped_at: new Date().toISOString() })
        .eq('id', questionId)
        .eq('session_id', sessionId)
        .eq('status', 'active')
        .select('*')
        .maybeSingle()
      if (error) throw error
      if (!data) return jsonResponse({ message: '題目已停止或不存在。' }, 409)
      return jsonResponse({ question: data })
    }

    if (action === 'get_recording_results') {
      const questionId = input.questionId
      if (!validUuid(questionId)) return jsonResponse({ message: '題目資料格式不正確。' }, 400)
      const { data: question, error: questionError } = await supabase
        .from('questions')
        .select('id, status, type')
        .eq('id', questionId)
        .eq('session_id', sessionId)
        .maybeSingle()
      if (questionError) throw questionError
      if (!question || !['pronunciation', 'oral_response'].includes(question.type)) {
        return jsonResponse({ message: '找不到錄音題目。' }, 404)
      }
      if (question.status === 'active') return jsonResponse({ responses: [] })

      const { data: responses, error } = await supabase
        .from('audio_responses')
        .select('id, session_id, question_id, participant_id, participant_name, storage_path, mime_type, duration_ms, analysis_status, detected_language, transcript, score, analysis_json, error_message, submitted_at, analyzed_at')
        .eq('question_id', questionId)
        .order('submitted_at')
      if (error) throw error
      const signedResponses = await Promise.all((responses || []).map(async (response) => {
        const { data: signed } = await supabase.storage.from('interact-recordings').createSignedUrl(response.storage_path, 3600)
        const { storage_path: _storagePath, ...safeResponse } = response
        return { ...safeResponse, signed_url: signed?.signedUrl || null }
      }))
      return jsonResponse({ responses: signedResponses })
    }

    if (action === 'get_session_recording_results') {
      const { data: responses, error } = await supabase
        .from('audio_responses')
        .select('id, session_id, question_id, participant_id, participant_name, mime_type, duration_ms, analysis_status, detected_language, transcript, score, analysis_json, error_message, submitted_at, analyzed_at')
        .eq('session_id', sessionId)
        .order('submitted_at')
      if (error) throw error
      return jsonResponse({ responses: responses || [] })
    }

    if (action === 'grade_question') {
      const questionId = input.questionId
      if (!validUuid(questionId)) return jsonResponse({ message: '題目資料格式不正確。' }, 400)
      const { data: question, error: questionError } = await supabase
        .from('questions')
        .select('id, allow_multiple, options, status')
        .eq('id', questionId)
        .eq('session_id', sessionId)
        .maybeSingle()
      if (questionError) throw questionError
      if (!question || !['stopped', 'closed'].includes(question.status)) {
        return jsonResponse({ message: '題目尚未停止或不存在。' }, 409)
      }

      const available = new Set(normalizedOptions(question.options))
      const correctAnswers = normalizedOptions(input.correctAnswers).filter((answer) => available.has(answer))
      const expected = [...correctAnswers].sort()
      const { error: updateQuestionError } = await supabase
        .from('questions')
        .update({
          correct_answer: question.allow_multiple ? null : correctAnswers[0] || null,
          correct_answers: correctAnswers,
        })
        .eq('id', questionId)
      if (updateQuestionError) throw updateQuestionError

      const { data: answers, error: answerError } = await supabase
        .from('answers')
        .select('id, answer_value, answer_values')
        .eq('question_id', questionId)
        .eq('session_id', sessionId)
      if (answerError) throw answerError
      for (const answer of answers || []) {
        const values = Array.isArray(answer.answer_values) && answer.answer_values.length
          ? answer.answer_values
          : answer.answer_value
            ? [answer.answer_value]
            : []
        const actual = [...new Set(values)].sort()
        const isCorrect = expected.length
          ? actual.length === expected.length && actual.every((value, index) => value === expected[index])
          : null
        const { error } = await supabase.from('answers').update({ is_correct: isCorrect }).eq('id', answer.id)
        if (error) throw error
      }
      return jsonResponse({ correctAnswers })
    }

    if (action === 'end_session') {
      const endedAt = new Date().toISOString()
      const [sessionResult, questionResult] = await Promise.all([
        supabase
          .from('sessions')
          .update({
            status: 'ended',
            ended_at: endedAt,
            danmaku_enabled: false,
            recording_enabled: false,
            captions_enabled: false,
            caption_status: 'idle',
            current_question_id: null,
          })
          .eq('id', sessionId)
          .select('id, title, code, status, created_at, ended_at')
          .single(),
        supabase
          .from('questions')
          .update({ status: 'stopped', stopped_at: endedAt })
          .eq('session_id', sessionId)
          .eq('status', 'active'),
      ])
      if (sessionResult.error) throw sessionResult.error
      if (questionResult.error) throw questionResult.error
      return jsonResponse({ session: sessionResult.data })
    }

    if (action === 'delete_session') {
      const { data: screenshots, error: screenshotError } = await supabase
        .from('screenshots')
        .select('storage_path')
        .eq('session_id', sessionId)
      if (screenshotError) throw screenshotError

      const paths = (screenshots || [])
        .map((screenshot) => screenshot.storage_path)
        .filter((path): path is string => typeof path === 'string' && Boolean(path))
      for (let index = 0; index < paths.length; index += 100) {
        const { error: storageError } = await supabase.storage
          .from('interact-screenshots')
          .remove(paths.slice(index, index + 100))
        if (storageError) throw storageError
      }

      const { data: recordings, error: recordingListError } = await supabase
        .from('audio_responses')
        .select('storage_path')
        .eq('session_id', sessionId)
      if (recordingListError) throw recordingListError
      const recordingPaths = (recordings || []).map((recording) => recording.storage_path).filter(Boolean)
      for (let index = 0; index < recordingPaths.length; index += 100) {
        const { error: storageError } = await supabase.storage
          .from('interact-recordings')
          .remove(recordingPaths.slice(index, index + 100))
        if (storageError) throw storageError
      }

      const orphanRecordingPaths = await listStorageFiles(
        supabase,
        'interact-recordings',
        `sessions/${sessionId}/recordings`,
      )
      const knownRecordingPaths = new Set(recordingPaths)
      const orphanPaths = orphanRecordingPaths.filter((path) => !knownRecordingPaths.has(path))
      for (let index = 0; index < orphanPaths.length; index += 100) {
        const { error: storageError } = await supabase.storage
          .from('interact-recordings')
          .remove(orphanPaths.slice(index, index + 100))
        if (storageError) throw storageError
      }


      // 檔案傳送：清掉這場次底下所有教師分享與學生回傳的檔案。
      const filePrefix = `sessions/${sessionId}/files`
      const transferPaths = await listStorageFiles(supabase, 'interact-files', filePrefix)
      for (let index = 0; index < transferPaths.length; index += 100) {
        const { error: storageError } = await supabase.storage
          .from('interact-files')
          .remove(transferPaths.slice(index, index + 100))
        if (storageError) throw storageError
      }
      const { data: deletedSession, error: deleteError } = await supabase
        .from('sessions')
        .delete()
        .eq('id', sessionId)
        .select('id')
        .maybeSingle()
      if (deleteError) throw deleteError
      if (!deletedSession) return jsonResponse({ message: '找不到要移除的場次，資料未變更。' }, 404)
      return jsonResponse({ deleted: true, sessionId })
    }

    if (action === 'share_content') {
      const body = typeof input.body === 'string' ? input.body.trim().slice(0, 5000) : ''
      const url = normalizedUrl(input.url)
      if (!body && !url) return jsonResponse({ message: '請輸入文字或網址。' }, 400)

      const { data, error } = await supabase
        .from('shared_contents')
        .insert({ session_id: sessionId, body: body || null, url })
        .select('*')
        .single()
      if (error) throw error
      return jsonResponse({ content: data })
    }

    if (action === 'draw_lottery') {
      const candidateIds = Array.isArray(input.candidateIds)
        ? [...new Set(input.candidateIds.filter((id: unknown) => typeof id === 'string'))].slice(0, 2000)
        : []
      if (!candidateIds.length) return jsonResponse({ message: '目前沒有在線學員。' }, 400)

      const [{ data: participants, error: participantError }, { data: priorEvents, error: eventError }] = await Promise.all([
        supabase.from('participants').select('id, name').eq('session_id', sessionId).in('id', candidateIds),
        supabase
          .from('session_events')
          .select('payload')
          .eq('session_id', sessionId)
          .eq('event_type', 'lottery')
          .order('created_at', { ascending: false })
          .limit(5000),
      ])
      if (participantError) throw participantError
      if (eventError) throw eventError

      const candidates = (participants || []) as ParticipantRecord[]
      if (!candidates.length) return jsonResponse({ message: '目前沒有可抽選的在線學員。' }, 400)

      const latestRound = Math.max(1, ...((priorEvents || []).map((event) => Number(event.payload?.round) || 1)))
      const drawnThisRound = new Set(
        (priorEvents || [])
          .filter((event) => (Number(event.payload?.round) || 1) === latestRound)
          .map((event) => event.payload?.winner_id)
          .filter((id): id is string => typeof id === 'string'),
      )
      let round = latestRound
      let eligible = candidates.filter((participant) => !drawnThisRound.has(participant.id))
      if (!eligible.length) {
        round += 1
        eligible = candidates
      }

      const winner = eligible[randomIndex(eligible.length)]
      const animationPool = shuffled(candidates).slice(0, 39)
      if (!animationPool.some((participant) => participant.id === winner.id)) animationPool.push(winner)
      const orderedPool = shuffled(animationPool)

      const payload = {
        round,
        winner_id: winner.id,
        winner_name: winner.name,
        candidate_count: candidates.length,
        candidate_names: orderedPool.map((participant) => participant.name),
        candidate_ids: orderedPool.map((participant) => participant.id),
        duration_ms: 6000,
        finalized: false,
      }
      const { data: event, error: insertError } = await supabase
        .from('session_events')
        .insert({ session_id: sessionId, event_type: 'lottery', payload })
        .select('*')
        .single()
      if (insertError) throw insertError
      return jsonResponse({ event })
    }

    if (action === 'start_buzzer') {
      const candidateIds = Array.isArray(input.candidateIds)
        ? [...new Set(input.candidateIds.filter((id: unknown) => typeof id === 'string'))].slice(0, 2000)
        : []
      if (!candidateIds.length) return jsonResponse({ message: '目前沒有在線學員。' }, 400)

      const [{ data: participants, error: participantError }, { data: priorEvents, error: eventError }] = await Promise.all([
        supabase.from('participants').select('id').eq('session_id', sessionId).in('id', candidateIds),
        supabase
          .from('session_events')
          .select('id, payload')
          .eq('session_id', sessionId)
          .eq('event_type', 'buzzer')
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      if (participantError) throw participantError
      if (eventError) throw eventError

      const eligibleIds = (participants || []).map((participant) => participant.id)
      if (!eligibleIds.length) return jsonResponse({ message: '目前沒有可搶答的在線學員。' }, 400)

      const preparedAt = new Date()
      const finalizedAt = preparedAt.toISOString()
      await Promise.all(
        (priorEvents || [])
          .filter((event) => event.payload?.finalized !== true)
          .map((event) => supabase
            .from('session_events')
            .update({ payload: { ...event.payload, accepting: false, finalized: true, cancelled: true, finalized_at: finalizedAt } })
            .eq('id', event.id)),
      )

      const payload = {
        candidate_count: eligibleIds.length,
        candidate_ids: eligibleIds,
        prepared_at: finalizedAt,
        expires_at: new Date(preparedAt.getTime() + 5 * 60 * 1000).toISOString(),
        duration_ms: 6000,
        finalized: false,
        accepting: false,
      }
      const { data: event, error: insertError } = await supabase
        .from('session_events')
        .insert({ session_id: sessionId, event_type: 'buzzer', payload })
        .select('*')
        .single()
      if (insertError) throw insertError
      return jsonResponse({ event })
    }

    if (action === 'activate_buzzer') {
      const eventId = typeof input.eventId === 'string' ? input.eventId : ''
      if (!eventId) return jsonResponse({ message: '找不到這次搶答。' }, 400)

      const { data: currentEvent, error: eventError } = await supabase
        .from('session_events')
        .select('*')
        .eq('id', eventId)
        .eq('session_id', sessionId)
        .eq('event_type', 'buzzer')
        .maybeSingle()
      if (eventError) throw eventError
      if (!currentEvent || currentEvent.payload?.finalized || currentEvent.payload?.cancelled) {
        return jsonResponse({ message: '這次搶答已失效。' }, 409)
      }
      if (currentEvent.payload?.accepting === true) return jsonResponse({ event: currentEvent })
      const readyExpiresAt = Date.parse(currentEvent.payload?.expires_at || '')
      if (!Number.isFinite(readyExpiresAt) || readyExpiresAt <= Date.now()) {
        return jsonResponse({ message: '這次搶答準備已逾時，請重新開啟。' }, 409)
      }

      const startedAt = new Date()
      const payload = {
        ...currentEvent.payload,
        accepting: true,
        started_at: startedAt.toISOString(),
        expires_at: new Date(startedAt.getTime() + 60 * 1000).toISOString(),
      }
      const { data: event, error: updateError } = await supabase
        .from('session_events')
        .update({ payload })
        .eq('id', eventId)
        .select('*')
        .single()
      if (updateError) throw updateError
      return jsonResponse({ event })
    }

    if (action === 'select_lottery_winner') {
      const eventId = typeof input.eventId === 'string' ? input.eventId : ''
      const winnerId = typeof input.winnerId === 'string' ? input.winnerId : ''
      if (!eventId || !winnerId) return jsonResponse({ message: '缺少抽籤結果資料。' }, 400)

      const { data: currentEvent, error: eventError } = await supabase
        .from('session_events')
        .select('*')
        .eq('id', eventId)
        .eq('session_id', sessionId)
        .eq('event_type', 'lottery')
        .maybeSingle()
      if (eventError) throw eventError
      if (!currentEvent) return jsonResponse({ message: '找不到這次抽籤。' }, 404)
      if (currentEvent.payload?.finalized) return jsonResponse({ event: currentEvent })

      const candidateIds = Array.isArray(currentEvent.payload?.candidate_ids)
        ? currentEvent.payload.candidate_ids.filter((id: unknown) => typeof id === 'string')
        : [currentEvent.payload?.winner_id].filter((id: unknown) => typeof id === 'string')
      if (!candidateIds.includes(winnerId)) return jsonResponse({ message: '這位學員不在本次抽籤名單中。' }, 400)

      const { data: winner, error: winnerError } = await supabase
        .from('participants')
        .select('id, name')
        .eq('id', winnerId)
        .eq('session_id', sessionId)
        .maybeSingle()
      if (winnerError) throw winnerError
      if (!winner) return jsonResponse({ message: '找不到抽中的學員。' }, 404)

      const payload = {
        ...currentEvent.payload,
        winner_id: winner.id,
        winner_name: winner.name,
        finalized: true,
      }
      const { data: event, error: updateError } = await supabase
        .from('session_events')
        .update({ payload })
        .eq('id', currentEvent.id)
        .select('*')
        .single()
      if (updateError) throw updateError

      const { error: resultEventError } = await supabase
        .from('session_events')
        .insert({ session_id: sessionId, event_type: 'lottery_result', payload })
      if (resultEventError) throw resultEventError

      return jsonResponse({ event })
    }

    return jsonResponse({ message: '不支援的講者操作。' }, 400)
  } catch (error) {
    const detail = errorDetail(error, 'Presenter action failed.')
    console.error('presenter-action failed', detail)
    if (/Only HTTP/.test(detail)) return jsonResponse({ message: '網址格式不正確，僅支援 http 或 https。' }, 400)
    if (/Gemini quiz generation failed \(429\)/.test(detail)) return jsonResponse({ message: 'AI 出題服務目前忙碌或已達速率限制，請稍候再試。' }, 429)
    if (/Gemini quiz generation failed \((500|502|503|504)\)/.test(detail)) return jsonResponse({ message: 'AI 出題服務暫時異常，系統已自動重試；請稍候再派送一次。' }, 502)
    if (/Gemini quiz generation request failed|timed out|TimeoutError|AbortError/i.test(detail)) return jsonResponse({ message: 'AI 出題服務連線逾時，請稍候再派送一次。' }, 504)
    if (/AI returned|AI did not follow|invalid answer key|needs at least|needs an accepted answer|has no prompt|unsupported question count/i.test(detail)) {
      return jsonResponse({ message: 'AI 產生的題目格式不完整，請調整出題方向後再試。' }, 422)
    }
    // Whoever runs this owns the project, so give them the real reason instead of
    // a generic apology they cannot act on.
    return jsonResponse({ message: `講者操作失敗：${detail.slice(0, 300)}` }, 500)
  }
})
