import { fileTypeIcon } from '../lib/fileKinds'

// One icon for a file the page cannot draw, chosen from its name.
export function FileTypeIcon({ name, mimeType, size = 18 }: { name: string; mimeType?: string | null; size?: number }) {
  const Icon = fileTypeIcon(name, mimeType)
  return <Icon size={size} />
}
