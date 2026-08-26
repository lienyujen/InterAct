import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const speakerLanguages = new Set(['zh-tw', 'en'])
const interpretationLanguagesSupported = new Set(['zh-tw', 'en', 'es', 'ja', 'ko', 'vi', 'de', 'id', 'th', 'fr'])

function normalizedLanguage(value: unknown, supported: Set<string>, fallback = 'zh-tw') {
  return typeof value === 'string' && supported.has(value) ? value : fallback
}

function createCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (byte) => codeAlphabet[byte % codeAlphabet.length]).join('')
}

function isDesktopOrigin(req: Request) {
  if (req.headers.get('x-interact-client') !== 'windows-app') return false

  const origin = req.headers.get('origin')
  if (origin === 'null' || origin === 'file://') return true
  if (!origin) return true

  try {
    const url = new URL(origin)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)
  if (!isDesktopOrigin(req)) return jsonResponse({ message: '請使用 InterAct Windows App 建立場次。' }, 403)

  try {
    const input = await req.json()
    const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : ''
    const sourceLanguage = normalizedLanguage(input.captionSourceLanguage, speakerLanguages)
    const interpretationLanguages = Array.isArray(input.interpretationLanguages)
      ? [...new Set(input.interpretationLanguages.filter((language: unknown): language is string => (
        typeof language === 'string' && interpretationLanguagesSupported.has(language) && language !== sourceLanguage
      )))]
      : []
    const interpretationAudioEnabled = Boolean(input.interpretationAudioEnabled) && interpretationLanguages.length > 0
    const presenterToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
    const tokenHash = await hashPresenterToken(presenterToken)
    const supabase = getAdminClient()

    let session = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await supabase
        .from('sessions')
        .insert({
          title: title || '未命名場次',
          code: createCode(),
          recording_enabled: false,
          captions_enabled: false,
          caption_source_language: sourceLanguage,
          caption_display_language: sourceLanguage,
          caption_font_size: 36,
          caption_font_bold: false,
          caption_position: 'bottom',
          interpretation_enabled: interpretationAudioEnabled,
          interpretation_audio_enabled: interpretationAudioEnabled,
          interpretation_languages: interpretationAudioEnabled ? interpretationLanguages : [],
        })
        .select('id, code')
        .single()

      if (!error) {
        session = data
        break
      }
      if (error.code !== '23505') throw error
    }

    if (!session) throw new Error('Could not create a unique session code.')

    const { error: keyError } = await supabase
      .from('presenter_session_keys')
      .insert({ session_id: session.id, token_hash: tokenHash })

    if (keyError) {
      await supabase.from('sessions').delete().eq('id', session.id)
      throw keyError
    }

    return jsonResponse({ sessionId: session.id, code: session.code, presenterToken })
  } catch (error) {
    console.error('create-session failed', error instanceof Error ? error.message : error)
    return jsonResponse({ message: '建立場次失敗。' }, 500)
  }
})
