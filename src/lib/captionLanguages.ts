export const CAPTION_LANGUAGES = [
  { code: 'zh-tw', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'de', label: 'Deutsch' },
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'th', label: 'ไทย' },
  { code: 'fr', label: 'Français' },
] as const

export const SPEAKER_LANGUAGES = CAPTION_LANGUAGES.filter((language) => ['zh-tw', 'en'].includes(language.code))
// Not a language but a choice: show the transcript as spoken, without the
// Taiwanese vocabulary substitutions that turn 視頻 into 影片 — useful when the
// wording itself is the point of the lesson.
export const SOURCE_CAPTION_LANGUAGE = 'source'

export const CAPTION_DISPLAY_LANGUAGES = [
  ...CAPTION_LANGUAGES.filter((language) => ['zh-tw', 'en', 'es', 'ja', 'ko', 'vi', 'de', 'id', 'th', 'fr'].includes(language.code)),
  { code: SOURCE_CAPTION_LANGUAGE, label: '原始語言（不改寫用詞）' },
]

// Everything downstream works in real languages, so this resolves the choice
// back to one before the captions are looked up or translated.
export function resolvedCaptionLanguage(displayLanguage: string, sourceLanguage: string) {
  return displayLanguage === SOURCE_CAPTION_LANGUAGE ? sourceLanguage : displayLanguage
}
export const INTERPRETATION_LANGUAGES = CAPTION_LANGUAGES.filter((language) => ['zh-tw', 'en', 'ja', 'ko', 'vi', 'id', 'th', 'es', 'de', 'fr'].includes(language.code))
export const DEFAULT_CAPTION_LANGUAGE = 'zh-tw'

export function defaultInterpretationLanguages(sourceLanguage: string) {
  return sourceLanguage === 'en' ? ['zh-tw'] : ['en']
}

export function captionLanguageLabel(code: string) {
  return CAPTION_LANGUAGES.find((language) => language.code === code)?.label || code
}
