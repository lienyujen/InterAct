import { corsHeaders, jsonResponse, errorDetail } from '../_shared/ai.ts'
import { analyzeAudioResponse, removeRecording } from '../_shared/audio-analysis.ts'
import { gradeCustomQuizAttempt } from '../_shared/custom-quiz.ts'
import { getAdminClient, hashParticipantToken } from '../_shared/supabase.ts'

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function validUuid(value: unknown) {
  return typeof value === 'string' && uuidPattern.test(value)
}

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024

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

async function verifyParticipant(
  supabase: ReturnType<typeof getAdminClient>,
  sessionId: string,
  participantId: string,
  participantToken: string,
) {
  if (!validUuid(sessionId) || !validUuid(participantId) || participantToken.length < 32) return null
  const tokenHash = await hashParticipantToken(participantToken)
  const { data } = await supabase
    .from('participant_session_keys')
    .select('participant_id, participants!inner(id, session_id, name)')
    .eq('participant_id', participantId)
    .eq('token_hash', tokenHash)
    .eq('participants.session_id', sessionId)
    .maybeSingle()
  const participant = data?.participants as unknown as { id: string; session_id: string; name: string } | null
  return participant || null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  let action = ''
  try {
    const input = await req.json()
    action = typeof input.action === 'string' ? input.action : ''
    const supabase = getAdminClient()

    if (action === 'join_session') {
      const reference = typeof input.sessionReference === 'string' ? input.sessionReference.trim() : ''
      const name = typeof input.name === 'string' ? input.name.trim().slice(0, 80) : ''
      const deviceId = typeof input.deviceId === 'string' ? input.deviceId.trim().slice(0, 200) : ''
      if (!reference || !name || !deviceId) return jsonResponse({ message: '姓名或場次資料不完整。' }, 400)

      const isId = validUuid(reference)
      const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq(isId ? 'id' : 'code', reference)
        .maybeSingle()
      if (sessionError) throw sessionError
      if (!session) return jsonResponse({ message: '找不到這個場次。' }, 404)
      if (!['active', 'ended'].includes(session.status)) return jsonResponse({ message: '這個場次目前無法加入。' }, 409)

      if (session.status === 'ended') {
        const now = new Date().toISOString()
        return jsonResponse({
          session,
          readOnly: true,
          participant: {
            id: crypto.randomUUID(),
            session_id: session.id,
            name,
            device_id: deviceId,
            joined_at: now,
            last_seen_at: now,
          },
          participantToken: `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', ''),
        })
      }

      const { data: existing, error: existingError } = await supabase
        .from('participants')
        .select('*')
        .eq('session_id', session.id)
        .eq('device_id', deviceId)
        .maybeSingle()
      if (existingError) throw existingError

      let participant = existing
      if (!participant) {
        const { data, error } = await supabase
          .from('participants')
          .insert({ session_id: session.id, name, device_id: deviceId })
          .select('*')
          .single()
        if (error) throw error
        participant = data
      }

      const participantToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
      const tokenHash = await hashParticipantToken(participantToken)
      const { error: keyError } = await supabase
        .from('participant_session_keys')
        .upsert({ participant_id: participant.id, token_hash: tokenHash })
      if (keyError) throw keyError
      return jsonResponse({ session, participant, participantToken })
    }

    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const participantId = typeof input.participantId === 'string' ? input.participantId : ''
    const participantToken = typeof input.participantToken === 'string' ? input.participantToken : ''

    // Keeps last_seen_at meaningful — it was written once at join and never
    // again, so it always equalled joined_at — and accumulates the time the
    // page spent hidden, which tells the presenter who drifted away.
    if (action === 'heartbeat') {
      const participant = await verifyParticipant(supabase, sessionId, participantId, participantToken)
      if (!participant) return jsonResponse({ message: '學員權限失效。' }, 403)
      const reported = Number(input.unfocusedMs)
      // A single report cannot exceed the interval by much; anything larger is a
      // clock jump rather than inattention.
      const unfocused = Number.isFinite(reported) ? Math.min(Math.max(Math.round(reported), 0), 30 * 60_000) : 0
      const streak = Number(input.focusStreakMs)
      const focusStreak = Number.isFinite(streak) ? Math.min(Math.max(Math.round(streak), 0), 12 * 60 * 60_000) : 0
      const { error } = await supabase.rpc('bump_participant_presence', {
        target_id: participantId,
        unfocused_delta: unfocused,
        focus_streak: focusStreak,
      })
      if (error) throw error
      return jsonResponse({ ok: true })
    }

    if (['get_custom_quiz', 'submit_custom_quiz', 'retry_custom_quiz_grading'].includes(action)) {
      const participant = await verifyParticipant(supabase, sessionId, participantId, participantToken)
      if (!participant) return jsonResponse({ message: '學員權限失效，請重新掃描 QR Code 加入場次。' }, 403)
      const questionId = typeof input.questionId === 'string' ? input.questionId : ''
      if (!validUuid(questionId)) return jsonResponse({ message: '測驗資料格式不正確。' }, 400)
      const { data: question, error: questionError } = await supabase.from('questions')
        .select('id, session_id, status, type, title').eq('id', questionId).eq('session_id', sessionId).maybeSingle()
      if (questionError) throw questionError
      if (!question || question.type !== 'custom_quiz') return jsonResponse({ message: '找不到自訂測驗。' }, 404)
      const { data: quiz, error: quizError } = await supabase.from('quizzes').select('*')
        .eq('question_id', questionId).eq('session_id', sessionId).maybeSingle()
      if (quizError) throw quizError

      if (action === 'get_custom_quiz') {
        if (!quiz && question.title === '出題失敗，請重新派送') {
          return jsonResponse({ message: 'AI 出題暫時失敗，請等待教師重新派送。' }, 503)
        }
        if (!quiz) return jsonResponse({ generating: true })
        const [{ data: items, error: itemError }, { data: attempt, error: attemptError }] = await Promise.all([
          supabase.from('quiz_items').select('*').eq('quiz_id', quiz.id).order('position'),
          supabase.from('quiz_attempts').select('*').eq('quiz_id', quiz.id).eq('participant_id', participantId).maybeSingle(),
        ])
        if (itemError || attemptError) throw itemError || attemptError
        let answers: unknown[] = []
        if (attempt) {
          const { data, error } = await supabase.from('quiz_item_answers').select('*').eq('attempt_id', attempt.id)
          if (error) throw error
          answers = data || []
        }
        return jsonResponse({ quiz, items: items || [], attempt: attempt || null, answers })
      }

      if (!quiz) return jsonResponse({ message: '自訂測驗仍在出題中，請稍候。' }, 409)

      const { data: activeSession, error: sessionError } = await supabase.from('sessions')
        .select('status').eq('id', sessionId).maybeSingle()
      if (sessionError) throw sessionError

      if (action === 'retry_custom_quiz_grading') {
        const { data: attempt, error: attemptError } = await supabase.from('quiz_attempts')
          .update({ status: 'grading', error_message: null, graded_at: null })
          .eq('quiz_id', quiz.id).eq('participant_id', participantId).eq('status', 'failed')
          .select('*').maybeSingle()
        if (attemptError) throw attemptError
        if (!attempt) return jsonResponse({ message: '目前沒有可重新評分的作答。' }, 409)
        EdgeRuntime.waitUntil(gradeCustomQuizAttempt(attempt.id))
        return jsonResponse({ attempt })
      }

      if (activeSession?.status !== 'active' || question.status !== 'active') {
        return jsonResponse({ message: '測驗已停止作答。' }, 409)
      }
      const submittedAnswers = Array.isArray(input.answers) ? input.answers : []
      const { data: items, error: itemError } = await supabase.from('quiz_items').select('*')
        .eq('quiz_id', quiz.id).order('position')
      if (itemError) throw itemError
      if (!items?.length || submittedAnswers.length !== items.length) {
        return jsonResponse({ message: '請完成所有題目後再送出。' }, 400)
      }
      const submittedByItem = new Map<string, { itemId: string; answerText?: string; answerValues?: string[] }>()
      for (const raw of submittedAnswers) {
        if (!raw || typeof raw !== 'object') return jsonResponse({ message: '作答資料格式不正確。' }, 400)
        const answer = raw as Record<string, unknown>
        const itemId = typeof answer.itemId === 'string' ? answer.itemId : ''
        if (!validUuid(itemId) || submittedByItem.has(itemId)) return jsonResponse({ message: '作答題號不正確。' }, 400)
        const answerText = typeof answer.answerText === 'string' ? answer.answerText.trim().slice(0, 4000) : ''
        const answerValues = Array.isArray(answer.answerValues)
          ? [...new Set(answer.answerValues.filter((value): value is string => typeof value === 'string').map((value) => value.trim().slice(0, 500)).filter(Boolean))].slice(0, 6)
          : []
        submittedByItem.set(itemId, { itemId, answerText, answerValues })
      }
      for (const item of items) {
        const submitted = submittedByItem.get(item.id)
        if (!submitted) return jsonResponse({ message: '作答題目不完整。' }, 400)
        if (item.type === 'multiple_choice') {
          if (!submitted.answerValues?.length || submitted.answerValues.some((value) => !item.options.includes(value))) {
            return jsonResponse({ message: `第 ${item.position} 題的選項不正確。` }, 400)
          }
        } else if (!submitted.answerText) {
          return jsonResponse({ message: `請完成第 ${item.position} 題。` }, 400)
        }
      }

      const attemptId = crypto.randomUUID()
      const { data: attempt, error: attemptError } = await supabase.from('quiz_attempts').insert({
        id: attemptId,
        session_id: sessionId,
        question_id: questionId,
        quiz_id: quiz.id,
        participant_id: participantId,
        participant_name: participant.name,
        status: 'grading',
      }).select('*').single()
      if (attemptError) {
        if (attemptError.code === '23505') return jsonResponse({ message: '這份測驗已經送出，不能修改答案。' }, 409)
        throw attemptError
      }
      try {
        const { error: answerError } = await supabase.from('quiz_item_answers').insert(items.map((item) => {
          const submitted = submittedByItem.get(item.id)!
          return {
            attempt_id: attemptId,
            item_id: item.id,
            answer_text: item.type === 'multiple_choice' ? null : submitted.answerText,
            answer_values: item.type === 'multiple_choice' ? submitted.answerValues : null,
          }
        }))
        if (answerError) throw answerError
        const { error: placeholderError } = await supabase.from('answers').insert({
          session_id: sessionId,
          question_id: questionId,
          participant_id: participantId,
          participant_name: participant.name,
          answer_text: '[自訂測驗評分中]',
        })
        if (placeholderError) throw placeholderError
      } catch (error) {
        await supabase.from('quiz_attempts').delete().eq('id', attemptId)
        throw error
      }

      if (items.every((item) => item.type === 'multiple_choice')) {
        await gradeCustomQuizAttempt(attemptId)
        const { data: gradedAttempt, error: gradedAttemptError } = await supabase.from('quiz_attempts')
          .select('*').eq('id', attemptId).single()
        if (gradedAttemptError) throw gradedAttemptError
        return jsonResponse({ attempt: gradedAttempt })
      }

      EdgeRuntime.waitUntil(gradeCustomQuizAttempt(attemptId))
      return jsonResponse({ attempt })
    }


    if (['prepare_file_upload', 'submit_file_response'].includes(action)) {
      const participant = await verifyParticipant(supabase, sessionId, participantId, participantToken)
      if (!participant) return jsonResponse({ message: '學員權限驗證失敗，請重新掃描 QR Code 加入。' }, 403)
      const questionId = typeof input.questionId === 'string' ? input.questionId : ''
      if (!validUuid(questionId)) return jsonResponse({ message: '題目資料不正確。' }, 400)
      const { data: question, error: questionError } = await supabase.from('questions')
        .select('id, status, type').eq('id', questionId).eq('session_id', sessionId).maybeSingle()
      if (questionError) throw questionError
      if (!question || question.type !== 'file_upload') return jsonResponse({ message: '找不到檔案上傳題。' }, 404)
      if (question.status !== 'active') return jsonResponse({ message: '教師已停止收件。' }, 409)

      const fileName = typeof input.fileName === 'string' ? input.fileName.trim().slice(0, 200) : ''
      const fileSize = Number(input.fileSize)
      if (!fileName || !Number.isInteger(fileSize) || fileSize < 1 || fileSize > MAX_UPLOAD_BYTES) {
        return jsonResponse({ message: '檔案資料不正確，單檔上限 200 MB。' }, 400)
      }

      if (action === 'prepare_file_upload') {
        const fileId = crypto.randomUUID()
        const storagePath = `sessions/${sessionId}/files/responses/${questionId}/${participantId}/${fileId}/${storageSafeName(fileName)}`
        const { data, error } = await supabase.storage.from('interact-files').createSignedUploadUrl(storagePath)
        if (error) throw error
        return jsonResponse({ fileId, storagePath, uploadToken: data.token })
      }

      const storagePath = typeof input.storagePath === 'string' ? input.storagePath : ''
      const expectedPrefix = `sessions/${sessionId}/files/responses/${questionId}/${participantId}/`
      if (!storagePath.startsWith(expectedPrefix)) {
        return jsonResponse({ message: '檔案路徑不正確。' }, 400)
      }
      const mimeType = typeof input.mimeType === 'string' && input.mimeType.trim()
        ? input.mimeType.trim().slice(0, 150)
        : 'application/octet-stream'

      const { data: saved, error: insertError } = await supabase.from('file_responses').insert({
        session_id: sessionId,
        question_id: questionId,
        participant_id: participantId,
        participant_name: participant.name,
        name: fileName,
        mime_type: mimeType,
        file_size: fileSize,
        storage_path: storagePath,
      }).select('*').single()
      if (insertError) throw insertError

      // One placeholder answer per student keeps response counts and the presenter's
      // realtime refresh working the same way they do for recordings.
      const { count } = await supabase.from('answers')
        .select('id', { count: 'exact', head: true })
        .eq('question_id', questionId).eq('participant_id', participantId)
      if (!count) {
        await supabase.from('answers').insert({
          session_id: sessionId,
          question_id: questionId,
          participant_id: participantId,
          participant_name: participant.name,
          answer_text: '[已上傳檔案]',
        })
      }
      return jsonResponse({ response: saved })
    }
    if (['prepare_recording_upload', 'submit_recording', 'get_recording_result'].includes(action)) {
      const participant = await verifyParticipant(supabase, sessionId, participantId, participantToken)
      if (!participant) return jsonResponse({ message: '學員權限驗證失敗，請重新掃描 QR Code 加入。' }, 403)
      const questionId = typeof input.questionId === 'string' ? input.questionId : ''
      if (!validUuid(questionId)) return jsonResponse({ message: '錄音題目資料不正確。' }, 400)

      const { data: question, error: questionError } = await supabase
        .from('questions')
        .select('id, session_id, screenshot_id, type, status, prompt_text')
        .eq('id', questionId)
        .eq('session_id', sessionId)
        .maybeSingle()
      if (questionError) throw questionError
      if (!question || !['pronunciation', 'oral_response'].includes(question.type)) {
        return jsonResponse({ message: '找不到錄音題目。' }, 404)
      }

      if (action === 'get_recording_result') {
        const { data: response, error } = await supabase
          .from('audio_responses')
          .select('id, session_id, question_id, participant_id, participant_name, mime_type, duration_ms, analysis_status, detected_language, transcript, score, analysis_json, error_message, submitted_at, analyzed_at, storage_path')
          .eq('question_id', questionId)
          .eq('participant_id', participantId)
          .maybeSingle()
        if (error) throw error
        if (!response) return jsonResponse({ response: null })
        if (question.status === 'active') {
          return jsonResponse({ response: {
            id: response.id,
            session_id: sessionId,
            question_id: questionId,
            participant_id: participantId,
            participant_name: participant.name,
            mime_type: response.mime_type,
            duration_ms: response.duration_ms,
            analysis_status: response.analysis_status,
            detected_language: null,
            transcript: null,
            score: null,
            analysis_json: null,
            error_message: null,
            submitted_at: response.submitted_at,
            analyzed_at: null,
          } })
        }
        const { data: signed, error: signedError } = await supabase.storage
          .from('interact-recordings')
          .createSignedUrl(response.storage_path, 3600)
        if (signedError) throw signedError
        const { storage_path: _storagePath, ...safeResponse } = response
        return jsonResponse({ response: { ...safeResponse, signed_url: signed.signedUrl } })
      }

      if (question.status !== 'active') return jsonResponse({ message: '本題已停止作答。' }, 409)

      const { data: activeSession, error: activeSessionError } = await supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .maybeSingle()
      if (activeSessionError) throw activeSessionError
      if (activeSession?.status !== 'active') return jsonResponse({ message: '課程已經結束，無法送出錄音。' }, 409)

      if (action === 'prepare_recording_upload') {
        const fileSize = Number(input.fileSize)
        if (!Number.isInteger(fileSize) || fileSize < 1 || fileSize > 10 * 1024 * 1024) {
          return jsonResponse({ message: '錄音檔不可超過 10 MB。' }, 400)
        }
        const { count, error: countError } = await supabase
          .from('answers')
          .select('id', { count: 'exact', head: true })
          .eq('question_id', questionId)
          .eq('participant_id', participantId)
        if (countError) throw countError
        if (count) return jsonResponse({ message: '本題已經送出錄音。' }, 409)
        const recordingId = crypto.randomUUID()
        const storagePath = `sessions/${sessionId}/recordings/${questionId}/${participantId}/${recordingId}.wav`
        const { data, error } = await supabase.storage.from('interact-recordings').createSignedUploadUrl(storagePath)
        if (error) throw error
        return jsonResponse({ recordingId, storagePath, uploadToken: data.token })
      }

      const recordingId = typeof input.recordingId === 'string' ? input.recordingId : ''
      const storagePath = typeof input.storagePath === 'string' ? input.storagePath : ''
      const durationMs = Math.round(Number(input.durationMs))
      const expectedPath = `sessions/${sessionId}/recordings/${questionId}/${participantId}/${recordingId}.wav`
      if (!validUuid(recordingId) || storagePath !== expectedPath || durationMs < 250 || durationMs > 180_000) {
        return jsonResponse({ message: '錄音資料格式不正確。' }, 400)
      }
      const { data: audioBlob, error: downloadError } = await supabase.storage.from('interact-recordings').download(storagePath)
      if (downloadError || !audioBlob) return jsonResponse({ message: '找不到已上傳的錄音。' }, 400)
      if (audioBlob.size < 1 || audioBlob.size > 10 * 1024 * 1024) {
        await removeRecording(storagePath)
        return jsonResponse({ message: '錄音檔大小不符合限制。' }, 400)
      }

      const { data: response, error: responseError } = await supabase
        .from('audio_responses')
        .insert({
          id: recordingId,
          session_id: sessionId,
          question_id: questionId,
          participant_id: participantId,
          participant_name: participant.name,
          storage_path: storagePath,
          mime_type: 'audio/wav',
          duration_ms: durationMs,
          file_size: audioBlob.size,
        })
        .select('id, analysis_status, submitted_at')
        .single()
      if (responseError) throw responseError

      const { error: answerError } = await supabase.from('answers').insert({
        session_id: sessionId,
        question_id: questionId,
        participant_id: participantId,
        participant_name: participant.name,
        answer_text: '[錄音已送出]',
      })
      if (answerError) {
        await supabase.from('audio_responses').delete().eq('id', recordingId)
        await removeRecording(storagePath)
        throw answerError
      }

      try {
        const { data: screenshot, error: screenshotError } = await supabase
          .from('screenshots')
          .select('public_url')
          .eq('id', question.screenshot_id)
          .single()
        if (screenshotError || !screenshot?.public_url) throw new Error('找不到錄音題目的截圖。')
        const request = {
          mode: question.type as 'pronunciation' | 'oral_response',
          promptText: question.prompt_text,
          screenshotUrl: screenshot.public_url,
          audioBytes: new Uint8Array(await audioBlob.arrayBuffer()),
          audioMimeType: 'audio/wav',
        }
        let analysis = null
        let lastError: unknown = null
        for (let attempt = 0; attempt < 2 && !analysis; attempt += 1) {
          try {
            analysis = await analyzeAudioResponse(request)
          } catch (error) {
            lastError = error
          }
        }
        if (!analysis) throw lastError || new Error('Audio analysis failed.')
        await supabase.from('audio_responses').update({
          analysis_status: 'success',
          detected_language: analysis.detected_language,
          transcript: analysis.transcript,
          score: analysis.score,
          analysis_json: analysis,
          analyzed_at: new Date().toISOString(),
        }).eq('id', recordingId)
        await supabase.from('answers').update({ answer_text: '[錄音分析完成]' })
          .eq('question_id', questionId)
          .eq('participant_id', participantId)
      } catch (error) {
        const detail = errorDetail(error, 'Audio analysis failed.')
        console.error('audio analysis failed', detail)
        await supabase.from('audio_responses').update({
          analysis_status: 'failed',
          error_message: detail.slice(0, 1000),
          analyzed_at: new Date().toISOString(),
        }).eq('id', recordingId)
        await supabase.from('answers').update({ answer_text: '[錄音分析失敗]' })
          .eq('question_id', questionId)
          .eq('participant_id', participantId)
      }
      return jsonResponse({ response })
    }

    if (action !== 'claim_buzzer' || !sessionId || !participantId) {
      return jsonResponse({ message: '不支援的學員操作。' }, 400)
    }

    const eventId = typeof input.eventId === 'string' ? input.eventId : ''
    if (!eventId) return jsonResponse({ message: '找不到這次搶答。' }, 400)

    const [{ data: session, error: sessionError }, { data: participant, error: participantError }] = await Promise.all([
      supabase
        .from('sessions')
        .select('status')
        .eq('id', sessionId)
        .maybeSingle(),
      supabase
        .from('participants')
        .select('id')
        .eq('id', participantId)
        .eq('session_id', sessionId)
        .maybeSingle(),
    ])
    if (sessionError) throw sessionError
    if (participantError) throw participantError
    if (!session) return jsonResponse({ message: '找不到場次。' }, 404)
    if (session.status !== 'active') return jsonResponse({ message: '課程已經結束，無法再搶答。' }, 409)
    if (!participant) return jsonResponse({ message: '找不到這位學員。' }, 404)

    const { data, error } = await supabase.rpc('claim_buzzer', {
      p_event_id: eventId,
      p_session_id: sessionId,
      p_participant_id: participantId,
    })
    if (error) throw error

    const event = Array.isArray(data) ? data[0] : data
    if (!event) return jsonResponse({ message: '這次搶答已失效。' }, 404)
    if (!event.payload?.finalized && !event.payload?.winner_id) {
      return jsonResponse({ message: '主講者尚未開始搶答，或這次搶答已失效。', event }, 409)
    }
    return jsonResponse({ event, won: event.payload?.winner_id === participantId })
  } catch (error) {
    const detail = errorDetail(error, 'Participant action failed.')
    console.error('participant-action failed', detail)
    return jsonResponse({
      message: action === 'claim_buzzer'
        ? '搶答失敗，請稍後再試。'
        : action === 'join_session'
          ? '加入場次失敗，請稍後再試。'
          : '錄音處理失敗，請稍後再試。',
    }, 500)
  }
})
