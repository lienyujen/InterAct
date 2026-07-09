import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { callAiJson, corsHeaders, jsonResponse } from '../_shared/ai.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const input = await req.json()
  const result = await callAiJson(
    '你是 InterAct 即時互動教學系統的簡答題分析助手。請用繁體中文輸出 JSON，整理所有答案的理解狀況、常見誤解、代表性答案與教學建議。不要自動批改個別學生。',
    input,
  )

  return jsonResponse({ ...result, input })
})
