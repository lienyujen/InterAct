import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { callAiJson, corsHeaders, jsonResponse } from '../_shared/ai.ts'

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const input = await req.json()
  const result = await callAiJson(
    '你是 InterAct 即時互動教學系統的課堂畫面理解助手。請閱讀講者派送的畫面資訊，辨識文字、概念、圖表、題目、選項與可能學習重點。不要替講者出題，不要過度發揮。請用繁體中文輸出 JSON。',
    input,
  )

  return jsonResponse({ ...result, input })
})
