// Shared bits of the 討論板, used by both the presenter's side and the class's.

// Every kind of card a student can put up.
export const BOARD_KINDS = ['text', 'link', 'image', 'file', 'audio', 'drawing'] as const

// Board uploads all go to interact-files, including the recordings.
//
// interact-recordings would have been the obvious home for audio, but it is
// built for a different job: private, so only the presenter can play a
// submission back, and restricted to audio/wav because the marker needs wav.
// A board card is the opposite — the whole class is meant to hear it, and
// nothing is going to mark it. Keeping the browser's own recording instead of
// transcoding it to wav makes the upload roughly a tenth of the size, which
// matters when thirty phones post at once on school wifi.
export const BOARD_BUCKET = 'interact-files'

export function boardStoragePrefix(sessionId: string, questionId: string, participantId: string) {
  return `sessions/${sessionId}/board/${questionId}/${participantId}/`
}

type StoredPost = { storage_path?: string | null; [key: string]: unknown }

// A card carries a storage path; a page needs an address it can put in an
// <img> or an <audio>. The bucket is public, so this is a string build rather
// than a round trip, but it stays in one place so the page never has to know
// which bucket a board lives in.
export function attachBoardUrls<T extends StoredPost>(
  supabase: { storage: { from: (bucket: string) => { getPublicUrl: (path: string) => { data: { publicUrl: string } } } } },
  posts: T[],
) {
  return posts.map((post) => {
    if (!post.storage_path) return { ...post, public_url: null }
    const { data } = supabase.storage.from(BOARD_BUCKET).getPublicUrl(post.storage_path)
    return { ...post, public_url: data.publicUrl }
  })
}
