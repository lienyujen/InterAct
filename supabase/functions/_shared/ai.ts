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

export async function callAiJson(systemPrompt: string, userPayload: unknown, schema?: Record<string, unknown>) {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  const model = Deno.env.get('GEMINI_MODEL') || 'gemini-3.6-flash'

  if (!apiKey) {
    return {
      status: 'skipped',
      output: { message: 'GEMINI_API_KEY is not configured.' },
    }
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(userPayload) }] }],
      generationConfig: {
        responseFormat: { text: { mimeType: 'APPLICATION_JSON', ...(schema ? { schema } : {}) } },
      },
    }),
  })

  if (!response.ok) {
    return {
      status: 'failed',
      output: { message: await response.text() },
    }
  }

  const data = await response.json()
  const content = data.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || '').join('') || ''

  try {
    return { status: 'success', output: JSON.parse(content) }
  } catch {
    return { status: 'success', output: { raw: content } }
  }
}
