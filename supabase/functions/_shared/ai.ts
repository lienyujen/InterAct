export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

export async function callAiJson(systemPrompt: string, userPayload: unknown) {
  const endpoint = Deno.env.get('AI_API_ENDPOINT')
  const apiKey = Deno.env.get('AI_API_KEY')
  const model = Deno.env.get('AI_MODEL') || 'gpt-4.1-mini'

  if (!endpoint || !apiKey) {
    return {
      status: 'skipped',
      output: {
        message: 'AI_API_ENDPOINT or AI_API_KEY is not configured.',
      },
    }
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
  })

  if (!response.ok) {
    return {
      status: 'failed',
      output: {
        message: await response.text(),
      },
    }
  }

  const data = await response.json()
  const content = data.choices?.[0]?.message?.content

  try {
    return {
      status: 'success',
      output: JSON.parse(content),
    }
  } catch {
    return {
      status: 'success',
      output: {
        raw: content,
      },
    }
  }
}
