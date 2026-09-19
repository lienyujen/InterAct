import type { BoardPost } from '../types'

// Whether a card should be drawn as a picture rather than as something to
// download.
//
// A student who means to share a photograph does not reliably press 圖片 — on a
// phone the file picker is right there under 檔案, and a picture sent that way
// arrived as a download link with a storage filename on it, which nobody
// opens. What decides this is what the file actually is, not which button was
// pressed to send it.
export function isImageCard(post: Pick<BoardPost, 'kind' | 'mime_type'>) {
  // A drawing is a picture the student made rather than one they had, but on
  // the wall it is a picture like any other.
  if (post.kind === 'image' || post.kind === 'drawing') return true
  return post.kind === 'file' && Boolean(post.mime_type?.toLowerCase().startsWith('image/'))
}

// The name to show for an uploaded card. The storage path ends in the original
// filename, which is the only name the student would recognise.
export function boardFileName(post: Pick<BoardPost, 'storage_path'>) {
  return decodeURIComponent(post.storage_path?.split('/').pop() || '')
}
