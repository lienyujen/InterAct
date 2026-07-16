import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const input = await req.json()
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const presenterToken = typeof input.presenterToken === 'string' ? input.presenterToken : ''
    const longUrl = typeof input.url === 'string' ? input.url : ''
    if (!sessionId || !presenterToken || !longUrl) return jsonResponse({ message: '缺少縮網址資料。' }, 400)

    const supabase = getAdminClient()
    const tokenHash = await hashPresenterToken(presenterToken)
    const { data: keyRecord } = await supabase
      .from('presenter_session_keys')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (!keyRecord) return jsonResponse({ message: '講者權限驗證失敗。' }, 403)

    const { data: session, error: sessionError } = await supabase
      .from('sessions')
      .select('code, short_join_url')
      .eq('id', sessionId)
      .single()
    if (sessionError) throw sessionError
    if (session.short_join_url) return jsonResponse({ shortUrl: session.short_join_url, cached: true })

    const parsedUrl = new URL(longUrl)
    if (parsedUrl.protocol !== 'https:' || parsedUrl.hash !== `#/join/${session.code}`) {
      return jsonResponse({ message: '加入網址格式不正確。' }, 400)
    }

    const apiKey = Deno.env.get('REURL_API_KEY')
    if (!apiKey) return jsonResponse({ message: '尚未設定 Reurl API key。' }, 503)

    const response = await fetch('https://api.reurl.cc/shorten', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'reurl-api-key': apiKey,
      },
      body: JSON.stringify({ url: longUrl }),
      signal: AbortSignal.timeout(10000),
    })
    const result = await response.json()
    if (!response.ok || result.res !== 'success' || typeof result.short_url !== 'string') {
      throw new Error(result.msg || result.err || `Reurl request failed (${response.status}).`)
    }

    const shortUrl = result.short_url.startsWith('http') ? result.short_url : `https://${result.short_url}`
    const { error: updateError } = await supabase.from('sessions').update({ short_join_url: shortUrl }).eq('id', sessionId)
    if (updateError) throw updateError

    return jsonResponse({ shortUrl, cached: false })
  } catch (error) {
    console.error('shorten-url failed', error)
    return jsonResponse({ message: 'Reurl 短網址產生失敗。' }, 502)
  }
})
