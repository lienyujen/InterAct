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
export const CAPTION_DISPLAY_LANGUAGES = CAPTION_LANGUAGES.filter((language) => ['zh-tw', 'en', 'es', 'ja', 'ko', 'vi', 'de', 'id', 'th', 'fr'].includes(language.code))
export const INTERPRETATION_LANGUAGES = CAPTION_LANGUAGES.filter((language) => ['zh-tw', 'en', 'ja', 'ko', 'vi', 'id', 'th', 'es', 'de', 'fr'].includes(language.code))
export const DEFAULT_CAPTION_LANGUAGE = 'zh-tw'

export function defaultInterpretationLanguages(sourceLanguage: string) {
  return sourceLanguage === 'en' ? ['zh-tw'] : ['en']
}

export function captionLanguageLabel(code: string) {
  return CAPTION_LANGUAGES.find((language) => language.code === code)?.label || code
}
