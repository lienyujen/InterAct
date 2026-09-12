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

const regionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    regions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // Gemini's own convention: [ymin, xmin, ymax, xmax], each 0-1000.
          box_2d: { type: 'array', items: { type: 'integer' } },
          label: { type: 'string' },
        },
        required: ['box_2d', 'label'],
      },
    },
  },
  required: ['title', 'regions'],
}

const regionPrompt = '你是 InterAct 的課堂出題助理。請看這張截圖，找出畫面裡「本來就有先後或邏輯順序」的區塊 —— 例如段落、步驟方塊、流程圖的節點、表格的列。用 box_2d 框出每一個區塊，格式是 [ymin, xmin, ymax, xmax]，每個值是 0 到 1000 的整數（相對於整張圖）。**regions 必須依照正確順序排列**，第一個就是順序上的第一塊。每個框要完整包住那一塊的內容、不要切到半個字，也不要框到空白或不相干的區域；框與框之間不要重疊。label 用繁體中文簡短描述那一塊是什麼（給老師看的，不會給學生）。若畫面裡找不到有順序關係的區塊，regions 回傳空陣列，不要勉強編造。presenter_direction 若有內容，優先照它指定的角度挑選區塊。'

export async function generateImageRegions(input: { sourceUrl: string; direction: string; count: number }) {
  const output = await ask(input.sourceUrl, input.direction, regionPrompt, regionSchema) as {
    title?: string
    regions?: Array<{ box_2d?: number[]; label?: string }>
  }
  const regions = (output.regions || [])
    .map((region) => ({
      box: (region.box_2d || []).map((value) => Math.min(1000, Math.max(0, Math.round(Number(value) || 0)))),
      label: String(region.label || '').trim().slice(0, 120),
    }))
    // A box that is empty or inverted would slice to nothing; drop it rather
    // than hand the class a blank tile.
    .filter((region) => region.box.length === 4 && region.box[2] > region.box[0] && region.box[3] > region.box[1])
    .slice(0, Math.min(10, Math.max(2, input.count || 5)))
  return { title: String(output.title || '排出正確順序').slice(0, 100), regions }
}
