import type { QuizRequestedType } from '../types'

export type CustomQuizSettings = {
  requestedCount: number | null
  requestedType: QuizRequestedType
  direction: string
}

// The count control carries 'auto' as a sentinel; the server wants null for it.
export function quizSettingsFrom(count: string, quizType: QuizRequestedType, direction: string): CustomQuizSettings {
  return {
    requestedCount: count === 'auto' ? null : Number(count),
    requestedType: quizType,
    direction: direction.trim(),
  }
}

// Mirrors isAnalyzableFile in supabase/functions/_shared/file-analysis.ts. Kept
// in step with it so the button only appears for files the server will accept —
// Office formats are absent there because Gemini cannot read those bytes.
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
