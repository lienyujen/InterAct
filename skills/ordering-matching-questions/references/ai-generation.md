# AI 出題與截圖分割

三種生成，全部餵同一張截圖給一個多模態模型，全部要求結構化 JSON 輸出。
prompt 是逐字抄錄的，裡面每一個限制都對應一種實際出現過的壞輸出。

實作用的是 Gemini，但只有 `box_2d` 的座標慣例是 Gemini 特有的；其餘換任何多模態模型都成立。

## 共用的呼叫形狀

截圖以 inline base64 傳送，老師的出題方向以 JSON 放在文字 part 裡：

```ts
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
```

老師的方向要當成**資料**傳（JSON 裡的一個欄位），不要串進 system prompt。
這是使用者輸入，串進指令等於開一個 prompt injection 的口。

逾時要設。這是在課堂當下跑的，一個卡住的請求會讓全班坐在那裡等。

## 一、排序題項目

```ts
const orderingSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string' },
    // 依正確順序。老師可以不同意並在派送前重排；
    // 模型先提一個出來，省掉老師自己打字。
    items: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'items'],
}
```

```
你是 InterAct 的課堂出題助理。請閱讀截圖，找出畫面裡本來就有順序關係的一組項目 —— 步驟、流程、時序、段落、大小或程度的排列都算 —— 並以繁體中文列出 4 到 8 個項目，**依正確順序排列**。每個項目寫成一句可以獨立看懂的短語，不要編號、不要出現「第一步」這種會直接洩漏答案的字眼，長度盡量一致。若截圖裡沒有任何有順序的內容，items 回傳空陣列，不要勉強編造。presenter_direction 若有內容，優先照它指定的角度出題。
```

四個限制各有理由：

- **不要編號、不要「第一步」** —— 打散之後編號還在，等於直接送分。
- **長度盡量一致** —— 長度會洩漏順序（結論通常比步驟長）。
- **可以獨立看懂** —— 打散之後學生是一個一個讀的，沒有上下文。
- **沒有就回空陣列** —— 沒有這句，模型會從任何一張圖硬編出順序。

後處理：

```ts
const items = (output.items || []).map((item) => String(item).trim().slice(0, 200)).filter(Boolean)
return { title: String(output.title || '排序題').slice(0, 100), items: items.slice(0, 8) }
```

空陣列時給老師可行動的訊息，不要只說失敗：
`AI 在這張截圖裡找不到有順序的內容，換一張或在題目欄說明要排什麼。`

## 二、配對題 pairs

```ts
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
```

```
你是 InterAct 的課堂出題助理。請閱讀截圖，找出畫面裡成對的概念 —— 詞與義、症狀與診斷、公式與適用情境、人物與事蹟都算 —— 並以繁體中文產生 3 到 6 組配對。left 是題目側（學生看到的固定欄），right 是被選的那一側；每個 right 只能對應一個 left，而且各個 right 之間必須明確不同，不可以出現兩個都說得通的選項。若截圖裡沒有可配對的內容，pairs 回傳空陣列，不要勉強編造。presenter_direction 若有內容，優先照它指定的角度出題。
```

**「各個 right 之間必須明確不同」是配對題最重要的一句。** 配對題最難的不是找出配對，
是確保沒有兩個選項都說得通。少了這句，模型會產出「細胞膜的功能」與「細胞膜的作用」這種學生挑不出來的選項。

## 三、截圖區塊（切圖排序）

Gemini 回傳的框是 `[ymin, xmin, ymax, xmax]`，每個值是 0–1000 的整數。

```ts
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
          box_2d: { type: 'array', items: { type: 'integer' } },
          label: { type: 'string' },
        },
        required: ['box_2d', 'label'],
      },
    },
  },
  required: ['title', 'regions'],
}
```

```
你是 InterAct 的課堂出題助理。請看這張截圖，找出畫面裡「本來就有先後或邏輯順序」的區塊 —— 例如段落、步驟方塊、流程圖的節點、表格的列。用 box_2d 框出每一個區塊，格式是 [ymin, xmin, ymax, xmax]，每個值是 0 到 1000 的整數（相對於整張圖）。**regions 必須依照正確順序排列**，第一個就是順序上的第一塊。每個框要完整包住那一塊的內容、不要切到半個字，也不要框到空白或不相干的區域；框與框之間不要重疊。label 用繁體中文簡短描述那一塊是什麼（給老師看的，不會給學生）。若畫面裡找不到有順序關係的區塊，regions 回傳空陣列，不要勉強編造。presenter_direction 若有內容，優先照它指定的角度挑選區塊。
```

後處理要把壞框丟掉，而不是讓它變成一張空白圖塊：

```ts
const regions = (output.regions || [])
  .map((region) => ({
    box: (region.box_2d || []).map((value) => Math.min(1000, Math.max(0, Math.round(Number(value) || 0)))),
    label: String(region.label || '').trim().slice(0, 120),
  }))
  // 空的或上下顛倒的框會切出一片空白，直接丟掉而不是發給全班
  .filter((region) => region.box.length === 4 && region.box[2] > region.box[0] && region.box[3] > region.box[1])
  .slice(0, Math.min(10, Math.max(2, input.count || 5)))
```

## 切圖在前端做

圖片已經在老師的機器上 —— 它就是剛剛截的那一張。伺服器端要做同樣的事得裝一套影像函式庫，
而 canvas 四行就寫完了。

```ts
export type Region = { box: number[]; label: string }

function toPixels(box: number[], width: number, height: number, pad: number) {
  const [ymin, xmin, ymax, xmax] = box
  const left = (xmin / 1000) * width
  const top = (ymin / 1000) * height
  const right = (xmax / 1000) * width
  const bottom = (ymax / 1000) * height
  // 模型把文字框得很緊，緊的框會切掉下伸部和字的最後一筆。
  // 留一點空白不花什麼成本，卻能讓圖塊保持可讀。
  return {
    x: Math.max(0, Math.round(left - pad)),
    y: Math.max(0, Math.round(top - pad)),
    width: Math.min(width, Math.round(right + pad)) - Math.max(0, Math.round(left - pad)),
    height: Math.min(height, Math.round(bottom + pad)) - Math.max(0, Math.round(top - pad)),
  }
}

// 一個區塊一張 PNG，順序就是給進來的順序 —— 那就是答案。
export async function sliceRegions(file: File, regions: Region[]): Promise<File[]> {
  const image = await loadImage(file)
  const pad = Math.round(Math.min(image.width, image.height) * 0.01)
  const slices: File[] = []

  for (const [index, region] of regions.entries()) {
    const rect = toPixels(region.box, image.width, image.height, pad)
    if (rect.width < 8 || rect.height < 8) continue
    const canvas = document.createElement('canvas')
    canvas.width = rect.width
    canvas.height = rect.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('無法建立圖片畫布。')
    // 白底而不是透明：這些東西是當成紙在讀的，
    // 透明的 PNG 在深色主題下會變成黑字配黑底。
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, rect.width, rect.height)
    context.drawImage(image, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('無法切出圖片。')
    slices.push(new File([blob], `slice-${index + 1}.png`, { type: 'image/png' }))
  }

  return slices
}
```

三個細節：`pad` 是短邊的 1%（緊框會切掉字）、白底（透明在深色主題下變黑字黑底）、
小於 8px 的直接跳過。

**上傳要一張一張來，不要一次全部併發。** 這是在教室 wifi 上跑的，
一口氣打出去的平行上傳正是它們開始失敗的方式。

```ts
const urls: string[] = []
for (const slice of slices) {
  const spot = await prepareUpload(slice.name)
  await upload(spot, slice)
  urls.push(publicUrlOf(spot))
}
```

## 圖片與文字的分辨

學生的清單在文字排序題裡裝的是純文字，在切圖排序裡裝的是圖片網址。
每一個 renderer 都用同一個函式分辨：

```ts
export function isImageValue(value: string) {
  return /^https?:\/\//.test(value) && /\.(png|jpe?g|webp)(\?|$)/i.test(value)
}
```

漏掉這個判斷，教師端的結果面板會把 storage 路徑當成題目文字念出來。

## 派送流程

**配對題：在派送流程裡生成，中間不畫任何東西。**

老師按下派送的當下，他的螢幕正投在投影幕上。先讓他看一眼配對結果就等於先讓全班看到答案。
所以配對題沒有「產生題目」按鈕 —— 生成發生在派送的那一刻：

```ts
let dispatchOptions = options
let dispatchKey = key

if (type === 'matching') {
  const generated = await generateQuestionItems('matching', promptText)
  const pairs = generated.pairs || []
  if (pairs.length < 2) throw new Error('AI 在這張截圖裡找不到可以配對的內容，換一張或在出題方向欄說明要配什麼。')
  dispatchOptions = pairs.map((pair) => pair.left)     // 題目側，固定不動
  const answers = pairs.map((pair) => pair.right)
  dispatchKey = { choices: shuffle(answers), correctValues: answers }
}
```

`choices` 是打散的，`correctValues` 保持與 `options` 對齊的原順序。兩者都要存，用途不同。

**切圖排序：**

```ts
if (type === 'ordering' && request.sliceCount) {
  const tiles = await buildSlicedOptions(file, promptText, request.sliceCount)
  dispatchOptions = shuffle(tiles)
  dispatchKey = { choices: [], correctValues: request.sliceHasAnswer ? tiles : [] }
}
```

`tiles` 是 AI 讀出來的順序，也就是答案；`dispatchOptions` 是打散後給學生的。
不勾「有標準答案」時 `correctValues` 留空，這一題就永遠不會有答案。

**文字排序題**在對話框裡就生成了，項目以正確順序顯示給老師看、派送時才打散。
這裡可以預覽是因為老師還在編輯 —— 他本來就要看到並調整順序。
