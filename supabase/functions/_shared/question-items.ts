import { geminiThinkingConfig, requestGemini } from './ai.ts'

// Ordering and matching are authored from the screenshot rather than typed out,
// because the material is already on the teacher's screen — the steps of the
// experiment, the terms and their definitions. What the teacher supplies is
// direction, not content.
//
// This talks to Gemini directly rather than through callAiJson, which folds its
// payload into a text part and so cannot carry a picture.

const orderingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    // In the correct order. The presenter can disagree and reorder before
    // dispatching; the model proposing one saves them typing it out.
    items: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'items'],
}

const matchingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { left: { type: 'string' }, right: { type: 'string' } },
        required: ['left', 'right'],
      },
    },
  },
  required: ['title', 'pairs'],
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function extractText(data: Record<string, unknown>) {
  const candidates = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }).candidates
  return candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
}

async function ask(sourceUrl: string, direction: string, systemPrompt: string, schema: Record<string, unknown>) {
  const image = await fetch(sourceUrl)
  if (!image.ok) throw new Error(`Could not download the screenshot (${image.status}).`)
  const mimeType = image.headers.get('content-type') || 'image/png'
  const data = bytesToBase64(new Uint8Array(await image.arrayBuffer()))

  const response = await requestGemini(JSON.stringify({
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{
      role: 'user',
      parts: [
        { text: JSON.stringify({ presenter_direction: direction || null }) },
        { inlineData: { mimeType, data } },
      ],
    }],
    generationConfig: {
      thinkingConfig: geminiThinkingConfig('realtime'),
      responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema } },
    },
  }), 'realtime', { primaryTimeoutMs: 40_000, fallbackTimeoutMs: 28_000 })

  const output = extractText(await response.json())
  if (!output) throw new Error('Gemini returned no items.')
  return JSON.parse(output)
}

const orderingPrompt = '你是 InterAct 的課堂出題助理。請閱讀截圖，找出畫面裡本來就有順序關係的一組項目 —— 步驟、流程、時序、段落、大小或程度的排列都算 —— 並以繁體中文列出 4 到 8 個項目，**依正確順序排列**。每個項目寫成一句可以獨立看懂的短語，不要編號、不要出現「第一步」這種會直接洩漏答案的字眼，長度盡量一致。若截圖裡沒有任何有順序的內容，items 回傳空陣列，不要勉強編造。presenter_direction 若有內容，優先照它指定的角度出題。'

const matchingPrompt = '你是 InterAct 的課堂出題助理。請閱讀截圖，找出畫面裡成對的概念 —— 詞與義、症狀與診斷、公式與適用情境、人物與事蹟都算 —— 並以繁體中文產生 3 到 6 組配對。left 是題目側（學生看到的固定欄），right 是被選的那一側；每個 right 只能對應一個 left，而且各個 right 之間必須明確不同，不可以出現兩個都說得通的選項。若截圖裡沒有可配對的內容，pairs 回傳空陣列，不要勉強編造。presenter_direction 若有內容，優先照它指定的角度出題。'

export async function generateOrderingItems(input: { sourceUrl: string; direction: string }) {
  const output = await ask(input.sourceUrl, input.direction, orderingPrompt, orderingSchema) as {
    title?: string
    items?: string[]
  }
  const items = (output.items || []).map((item) => String(item).trim().slice(0, 200)).filter(Boolean)
  return { title: String(output.title || '排序題').slice(0, 100), items: items.slice(0, 8) }
}

export async function generateMatchingPairs(input: { sourceUrl: string; direction: string }) {
  const output = await ask(input.sourceUrl, input.direction, matchingPrompt, matchingSchema) as {
    title?: string
    pairs?: Array<{ left?: string; right?: string }>
  }
  const pairs = (output.pairs || [])
    .map((pair) => ({
      left: String(pair.left || '').trim().slice(0, 200),
      right: String(pair.right || '').trim().slice(0, 200),
    }))
    .filter((pair) => pair.left && pair.right)
  return { title: String(output.title || '配對題').slice(0, 100), pairs: pairs.slice(0, 6) }
}
