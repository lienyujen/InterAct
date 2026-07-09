import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { callAiJson, corsHeaders, jsonResponse } from '../_shared/ai.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const input = await req.json()
  const result = await callAiJson(
    '你是 InterAct 即時互動教學系統的課後回饋分析助手。請用繁體中文輸出 JSON，整合訊息、題目、作答與 Exit Ticket，產生課程摘要、困惑、參與情況與下次教學建議。',
    input,
  )

  return jsonResponse({ ...result, input })
})
