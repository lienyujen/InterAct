export async function createCaptionTextNormalizer(enabled: boolean): Promise<(language: string, text: string) => string> {
  if (!enabled) return (_language, text) => text
  const { Converter } = await import('opencc-js/cn2t')
  const toTaiwanTraditional = Converter({ from: 'cn', to: 'twp' })
  return (language, text) => language.toLowerCase() === 'zh-tw' ? toTaiwanTraditional(text) : text
}
