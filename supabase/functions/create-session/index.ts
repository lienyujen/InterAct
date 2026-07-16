import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function createCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (byte) => codeAlphabet[byte % codeAlphabet.length]).join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const input = await req.json()
    const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : ''
    const presenterToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '')
    const tokenHash = await hashPresenterToken(presenterToken)
    const supabase = getAdminClient()

    let session = null
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { data, error } = await supabase
        .from('sessions')
        .insert({ title: title || '未命名場次', code: createCode() })
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
