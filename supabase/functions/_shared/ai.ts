export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, x-interact-client, apikey, content-type',
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

export type AiProfile = 'realtime' | 'deep'
export type ThinkingLevel = 'LOW' | 'MEDIUM' | 'HIGH'

export const THINKING_LEVELS: ThinkingLevel[] = ['LOW', 'MEDIUM', 'HIGH']

// Deep analysis defaults to LOW: MEDIUM regularly exhausted the request timeout on
// large sessions, and a report that arrives is worth more than one that never does.
const defaultThinkingLevel: Record<AiProfile, ThinkingLevel> = { realtime: 'LOW', deep: 'LOW' }

export function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
  return typeof value === 'string' && (THINKING_LEVELS as string[]).includes(value.toUpperCase())
    ? value.toUpperCase() as ThinkingLevel
    : undefined
}

type GeminiRequestOptions = {
  primaryTimeoutMs?: number
  fallbackTimeoutMs?: number
}

function retryableStatus(status: number) {
  // 404 means this key cannot reach that model, which is exactly what the fallback is for.
  return status === 404 || status === 408 || status === 429 || status >= 500
}

export function geminiModels(profile: AiProfile) {
  if (profile === 'deep') {
    const primary = Deno.env.get('GEMINI_DEEP_MODEL') || Deno.env.get('GEMINI_MODEL') || 'gemini-3.7-flash'
    const fallback = Deno.env.get('GEMINI_DEEP_FALLBACK_MODEL') || Deno.env.get('GEMINI_FALLBACK_MODEL') || 'gemini-3.6-flash'
    return fallback === primary ? [primary] : [primary, fallback]
  }

  // Measured on the question-translation call at LOW thinking, two independent
  // samples: 3.7 answered in 1.1-1.3 s, 3.6 in 1.7-1.9 s, and 3.8 averaged
  // similarly to 3.7 but spiked to 5.4 s. Newer turned out to be faster here, so
  // this profile no longer sits a version behind the deep one for latency.
  const primary = Deno.env.get('GEMINI_REALTIME_MODEL') || 'gemini-3.7-flash'
  const fallback = Deno.env.get('GEMINI_REALTIME_FALLBACK_MODEL') || 'gemini-3.6-flash'
  return fallback === primary ? [primary] : [primary, fallback]
}

export function geminiThinkingConfig(profile: AiProfile, level?: ThinkingLevel) {
  return { thinkingLevel: level || defaultThinkingLevel[profile] }
}

export async function requestGemini(
  body: string,
  profile: AiProfile,
  options: GeminiRequestOptions = {},
) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.')

  const models = geminiModels(profile)
  const primaryTimeoutMs = options.primaryTimeoutMs ?? (profile === 'deep' ? 90_000 : 12_000)
  const fallbackTimeoutMs = options.fallbackTimeoutMs ?? (profile === 'deep' ? 60_000 : 18_000)
  let failureMessage = 'AI request failed.'

  for (const [index, model] of models.entries()) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body,
        signal: AbortSignal.timeout(index === 0 ? primaryTimeoutMs : fallbackTimeoutMs),
      })
      if (response.ok) return response

      failureMessage = (await response.text()).slice(0, 1000) || `AI request failed with status ${response.status}.`
      if (!retryableStatus(response.status)) {
        const nonRetryableError = new Error(failureMessage)
        nonRetryableError.name = 'NonRetryableGeminiError'
        throw nonRetryableError
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'NonRetryableGeminiError') throw error
      failureMessage = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
        ? `AI request timed out on ${model}.`
        : error instanceof Error ? error.message : 'AI request failed.'
    }

    if (index < models.length - 1) console.warn(`Gemini unavailable on ${model}; switching to ${models[index + 1]}.`)
  }

  throw new Error(failureMessage)
}

export async function callAiJson(
  systemPrompt: string,
  userPayload: unknown,
  schema?: Record<string, unknown>,
  profile: AiProfile = 'realtime',
  thinkingLevel?: ThinkingLevel,
) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')

  if (!apiKey) {
    return {
      status: 'skipped',
      output: { message: 'GEMINI_API_KEY is not configured.' },
    }
  }

  let response: Response
  try {
    response = await requestGemini(JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(userPayload) }] }],
      generationConfig: {
        thinkingConfig: geminiThinkingConfig(profile, thinkingLevel),
        responseFormat: { text: { mimeType: 'APPLICATION_JSON', ...(schema ? { schema } : {}) } },
      },
    }), profile)
  } catch (error) {
    return { status: 'failed', output: { message: error instanceof Error ? error.message : 'AI request failed.' } }
  }

  const data = await response.json()
  const content = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || ''

  try {
    return { status: 'success', output: JSON.parse(content) }
  } catch {
    return { status: 'success', output: { raw: content } }
  }
}

// Supabase returns plain objects for database and storage failures, not Error
// instances, so `error instanceof Error` discards exactly the detail needed to
// tell a missing table from a rejected key. Read whatever the value actually is.
export function errorDetail(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message
  if (error && typeof error === 'object') {
    const shape = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown }
    const parts = [shape.message, shape.details, shape.hint, shape.code]
      .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    if (parts.length) return [...new Set(parts)].join(' | ')
    try {
      const serialised = JSON.stringify(error)
      if (serialised && serialised !== '{}') return serialised.slice(0, 300)
    } catch {
      // Circular or otherwise unserialisable — fall through to the caller's wording.
    }
  }
  if (typeof error === 'string' && error.trim()) return error
  return fallback
}
