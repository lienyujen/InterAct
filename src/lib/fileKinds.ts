import {
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Presentation,
} from 'lucide-react'

// What a student handed in, told from the name they handed it in under.
//
// The extension leads rather than the MIME type: a browser reports .xlsx as
// application/octet-stream often enough, and the name is what the student sees
// beside the icon, so an icon that disagrees with the name looks like a bug
// even when the MIME type was right.
const byExtension: Array<[RegExp, typeof File]> = [
  [/\.(xlsx?|xlsm|csv|tsv|ods|numbers)$/i, FileSpreadsheet],
  [/\.(pptx?|odp|key)$/i, Presentation],
  [/\.(pdf|docx?|odt|rtf|pages|txt|md)$/i, FileText],
  [/\.(png|jpe?g|webp|gif|heic|heif|bmp|svg|avif)$/i, FileImage],
  [/\.(mp3|wav|m4a|aac|ogg|oga|flac|weba)$/i, FileMusic],
  [/\.(mp4|mov|webm|avi|mkv|m4v)$/i, FileVideoCamera],
  [/\.(zip|rar|7z|tar|gz|tgz|bz2)$/i, FileArchive],
  [/\.(js|mjs|cjs|tsx?|jsx|py|java|cs|cpp?|h|rb|go|rs|php|html?|css|json|xml|ya?ml|sql|sh|ps1)$/i, FileCode],
]

const byMimePrefix: Array<[string, typeof File]> = [
  ['image/', FileImage],
  ['audio/', FileMusic],
  ['video/', FileVideoCamera],
  ['text/', FileText],
]

export function fileTypeIcon(name: string, mimeType?: string | null) {
  for (const [pattern, icon] of byExtension) if (pattern.test(name)) return icon
  const mime = (mimeType || '').toLowerCase()
  if (mime.includes('spreadsheet') || mime.includes('excel')) return FileSpreadsheet
  if (mime.includes('presentation') || mime.includes('powerpoint')) return Presentation
  if (mime.includes('pdf') || mime.includes('word') || mime.includes('document')) return FileText
  if (mime.includes('zip') || mime.includes('compressed')) return FileArchive
  for (const [prefix, icon] of byMimePrefix) if (mime.startsWith(prefix)) return icon
  return File
}

// Whether to draw it rather than offer it as something to open. Same rule the
// 討論板 uses: what the file actually is decides, not which button sent it.
export function isImageFileName(name: string, mimeType?: string | null) {
  return (mimeType || '').toLowerCase().startsWith('image/')
    || /\.(png|jpe?g|webp|gif|heic|heif|bmp|avif)$/i.test(name)
}
