import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

const supportedLanguages = new Set(['zh-tw', 'zh-cn', 'en', 'ja', 'ko', 'es', 'fr', 'de', 'th', 'vi', 'id'])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const input = await req.json()
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const presenterToken = typeof input.presenterToken === 'string' ? input.presenterToken : ''
    const mode = input.mode === 'translation' ? 'translation' : 'transcription'
    const targetLanguage = typeof input.targetLanguage === 'string' ? input.targetLanguage : ''
    const sdp = typeof input.sdp === 'string' ? input.sdp : ''
    if (!sessionId || !presenterToken || (mode === 'translation' && !sdp)) return jsonResponse({ message: '缺少講師字幕權限資料。' }, 400)

    const supabase = getAdminClient()
    const tokenHash = await hashPresenterToken(presenterToken)
    const [{ data: keyRecord }, { data: session }] = await Promise.all([
      supabase.from('presenter_session_keys').select('session_id').eq('session_id', sessionId).eq('token_hash', tokenHash).maybeSingle(),
      supabase.from('sessions').select('status, recording_enabled, caption_source_language, caption_display_language, interpretation_enabled, interpretation_languages').eq('id', sessionId).maybeSingle(),
    ])
    if (!keyRecord) return jsonResponse({ message: '講師權限驗證失敗。' }, 403)
    if (!session || session.status !== 'active') return jsonResponse({ message: '場次已結束，無法開啟字幕。' }, 409)
    if (!session.recording_enabled) return jsonResponse({ message: '課程錄製尚未開啟。' }, 409)

    const sourceLanguage = supportedLanguages.has(session.caption_source_language) ? session.caption_source_language : 'zh-tw'
    if (mode === 'translation' && (
      !supportedLanguages.has(targetLanguage) ||
      (
        session.caption_display_language !== targetLanguage
        && (!session.interpretation_enabled || !session.interpretation_languages?.includes(targetLanguage))
      )
    )) return jsonResponse({ message: '這個口譯語言未在場次中啟用。' }, 400)

    const apiKey = Deno.env.get('OPENAI_API_KEY')
    if (!apiKey) return jsonResponse({ message: '尚未在 Supabase 設定 OPENAI_API_KEY。' }, 503)

    const sessionConfig = mode === 'translation'
      ? {
          model: 'gpt-realtime-translate',
          audio: {
            output: { language: targetLanguage },
          },
        }
      : {
          type: 'transcription',
          audio: {
            input: {
              transcription: {
                model: 'gpt-realtime-whisper',
                language: sourceLanguage,
                delay: 'minimal',
              },
              turn_detection: null,
            },
          },
        }

    if (mode === 'transcription') {
      const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Safety-Identifier': `interact_${tokenHash.slice(0, 48)}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expires_after: { anchor: 'created_at', seconds: 60 },
          session: sessionConfig,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      const responseText = await response.text()
      if (!response.ok) {
        console.error('OpenAI realtime client secret failed', response.status, responseText.slice(0, 1000))
        let detail = ''
        try {
          const body = JSON.parse(responseText)
          detail = typeof body?.error?.message === 'string' ? body.error.message : ''
        } catch {
          detail = ''
        }
        return jsonResponse({ message: '無法建立即時字幕連線。', ...(detail ? { detail } : {}) }, response.status)
      }
      const secret = JSON.parse(responseText)
      if (typeof secret?.value !== 'string' || !secret.value) {
        return jsonResponse({ message: 'OpenAI 未回傳可用的即時字幕權杖。' }, 502)
      }
      return jsonResponse({
        clientSecret: secret.value,
        mode,
        sourceLanguage,
        targetLanguage: sourceLanguage,
      })
    }

    let response: Response | null = null
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const formData = new FormData()
      formData.set('sdp', sdp)
      formData.set('session', JSON.stringify(sessionConfig))
      response = await fetch('https://api.openai.com/v1/realtime/translations/calls', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'OpenAI-Safety-Identifier': `interact_${tokenHash.slice(0, 48)}`,
        },
        body: formData,
        signal: AbortSignal.timeout(15_000),
      })
      if (![502, 503, 504].includes(response.status) || attempt === 1) break
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    if (!response) return jsonResponse({ message: '無法建立即時字幕連線。' }, 503)
    const answerSdp = await response.text()
    if (!response.ok) {
      console.error('OpenAI realtime call failed', response.status, answerSdp.slice(0, 1000))
      const contentType = response.headers.get('content-type') || ''
      let detail = ''
      if (contentType.includes('application/json')) {
        try {
          const body = JSON.parse(answerSdp)
          detail = typeof body?.error?.message === 'string' ? body.error.message : ''
        } catch {
          detail = ''
        }
      }
      const message = [502, 503, 504].includes(response.status)
        ? 'OpenAI 即時字幕服務暫時逾時，請重新開啟課程錄製。'
        : '無法建立即時字幕連線。'
      return jsonResponse({ message, ...(detail ? { detail } : {}) }, response.status)
    }

    return jsonResponse({ sdp: answerSdp, mode, sourceLanguage, targetLanguage: mode === 'translation' ? targetLanguage : sourceLanguage })
  } catch (error) {
    console.error('openai-realtime-session failed', error instanceof Error ? error.message : error)
    return jsonResponse({ message: '建立即時字幕連線失敗。' }, 500)
  }
})
