import { getPresenterToken } from './presenterAuth'
import { requireSupabase } from './supabase'
import type { LotterySessionEvent } from '../types'

export async function finalizeLottery(sessionId: string, eventId: string, winnerId: string) {
  const presenterToken = getPresenterToken(sessionId)
  if (!presenterToken) throw new Error('這個場次沒有講者操作權限。')

  const { data, error } = await requireSupabase().functions.invoke('presenter-action', {
    body: {
      action: 'select_lottery_winner',
      sessionId,
      presenterToken,
      eventId,
      winnerId,
    },
  })
  if (error) throw error
  if (!data?.event) throw new Error(data?.message || '無法確認抽籤結果。')
  return data.event as LotterySessionEvent
}
