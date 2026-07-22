import { getPresenterToken } from './presenterAuth'
import { requireSupabase } from './supabase'
import type { LotterySessionEvent } from '../types'

export async function finalizeLottery(sessionId: string, eventId: string, winnerId: string) {
  const presenterToken = getPresenterToken(sessionId)
  if (!presenterToken) throw new Error('?????????????')

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
  if (!data?.event) throw new Error(data?.message || '?????????')
  return data.event as LotterySessionEvent
}
