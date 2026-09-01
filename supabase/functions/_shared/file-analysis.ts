import { geminiThinkingConfig, requestGemini } from './ai.ts'

// Gemini reads these directly. Office formats (docx/pptx/xlsx) are deliberately
// absent: they would need conversion, and a confident-sounding analysis of bytes
// the model cannot actually read is worse than saying it was not analysed.
const analyzableMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
])

const analyzableExtensions = /\.(png|jpe?g|webp|heic|heif|pdf|txt|md|csv)$/i

export function isAnalyzableFile(mimeType: string, fileName: string) {
  return analyzableMimeTypes.has(mimeType.toLowerCase()) || analyzableExtensions.test(fileName)
}

const fileAnalysisSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    summary_zh_tw: { type: 'string' },
    summary_en: { type: 'string' },
    strengths_zh_tw: { type: 'array', items: { type: 'string' } },
    strengths_en: { type: 'array', items: { type: 'string' } },
    improvements_zh_tw: { type: 'array', items: { type: 'string' } },
    improvements_en: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'summary_zh_tw', 'summary_en',
    'strengths_zh_tw', 'strengths_en',
    'improvements_zh_tw', 'improvements_en',
  ],
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

export async function analyzeFileResponse(input: {
  promptText: string | null
  fileName: string
  mimeType: string
  fileBytes: Uint8Array
}) {
  const response = await requestGemini(JSON.stringify({
    systemInstruction: {
      parts: [{
        text: '你是 InterAct 的作業回饋助理。學員上傳了一份檔案回應教師的題目。請先以繁體中文給出具體、尊重且可行的個別回饋，再提供結構相同且忠實的英文版本；英文版是翻譯，不可另行推論。summary 概述這份檔案回應了什麼、完成度如何；strengths 指出做得好的地方；improvements 提出可改進之處。所有結論都要根據檔案內容，不可臆測看不到的部分；若檔案內容不足以判斷，請在 summary 誠實說明，不可捏造。',
      }],
    },
    contents: [{
      role: 'user',
      parts: [
        { text: JSON.stringify({ presenter_question: input.promptText, file_name: input.fileName }) },
        { inlineData: { mimeType: input.mimeType, data: bytesToBase64(input.fileBytes) } },
      ],
    }],
    generationConfig: {
      thinkingConfig: geminiThinkingConfig('realtime'),
      responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: fileAnalysisSchema } },
    },
  }), 'realtime', { primaryTimeoutMs: 40_000, fallbackTimeoutMs: 40_000 })

  const output = extractText(await response.json())
  if (!output) throw new Error('Gemini returned no file analysis.')
  return JSON.parse(output)
}
