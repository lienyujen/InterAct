import { requireSupabase } from './supabase'
import { getPresenterToken } from './presenterAuth'
import type { BoardPost, BoardReaction, Question } from '../types'

export type BoardSnapshot = {
  question: Question
  posts: BoardPost[]
  reactions: BoardReaction[]
  imageUrl: string | null
}

// The presenter reads the wall through the edge function rather than from the
// table, for the same reason the class cannot: the row-level policy hides
// everything until the board is revealed. The presenter is the one person who
// has to see it before that — they are the one deciding when to open it — so
// the read runs on the service role, and it returns the withdrawn and hidden
// cards too.
export async function loadBoard(sessionId: string, questionId: string): Promise<BoardSnapshot> {
  const presenterToken = getPresenterToken(sessionId)
  if (!presenterToken) throw new Error('找不到講者權限，請重新加入場次。')
  const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
    body: { action: 'get_board', sessionId, presenterToken, questionId },
  })
  if (error) throw error
  if (!data?.question) throw new Error(data?.message || '讀取討論板失敗。')
  return {
    question: data.question as Question,
    posts: (data.posts || []) as BoardPost[],
    reactions: (data.reactions || []) as BoardReaction[],
    imageUrl: (data.imageUrl as string | null) || null,
  }
}

export async function boardAction(sessionId: string, body: Record<string, unknown>) {
  const presenterToken = getPresenterToken(sessionId)
  if (!presenterToken) throw new Error('找不到講者權限，請重新加入場次。')
  const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
    body: { sessionId, presenterToken, ...body },
  })
  if (error) throw error
  if (data?.message && !data?.ok && !data?.post && !data?.revealedAt) throw new Error(data.message)
  return data
}

// Pinned first, then oldest first. Withdrawn and hidden cards stay in the list
// for the presenter — a card someone took down is still something that
// happened in the room — and are drawn faded rather than removed.
export function sortedBoardPosts(posts: BoardPost[]) {
  return [...posts]
    .filter((post) => !post.reply_to)
    .sort((left, right) => {
      const pinned = Number(Boolean(right.pinned_at)) - Number(Boolean(left.pinned_at))
      if (pinned) return pinned
      return left.created_at.localeCompare(right.created_at)
    })
}

export function repliesByParent(posts: BoardPost[]) {
  const byParent = new Map<string, BoardPost[]>()
  for (const post of posts) {
    if (!post.reply_to) continue
    byParent.set(post.reply_to, [...(byParent.get(post.reply_to) || []), post])
  }
  return byParent
}
