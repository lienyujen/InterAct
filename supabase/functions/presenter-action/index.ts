import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

type ParticipantRecord = { id: string; name: string }

function randomIndex(length: number) {
  if (length <= 1) return 0
  const ceiling = Math.floor(0x100000000 / length) * length
  const values = new Uint32Array(1)
  do crypto.getRandomValues(values)
  while (values[0] >= ceiling)
  return values[0] % length
}

function shuffled<T>(items: T[]) {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1)
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }
  return copy
}

function normalizedUrl(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return null
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
  const parsed = new URL(candidate)
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Only HTTP and HTTPS links are supported.')
  return parsed.toString().slice(0, 2048)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const input = await req.json()
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const presenterToken = typeof input.presenterToken === 'string' ? input.presenterToken : ''
    const action = typeof input.action === 'string' ? input.action : ''
    if (!sessionId || !presenterToken || !action) return jsonResponse({ message: '???????????' }, 400)

    const supabase = getAdminClient()
    const tokenHash = await hashPresenterToken(presenterToken)
    const { data: keyRecord } = await supabase
      .from('presenter_session_keys')
      .select('session_id')
      .eq('session_id', sessionId)
      .eq('token_hash', tokenHash)
      .maybeSingle()
    if (!keyRecord) return jsonResponse({ message: '?????????' }, 403)

    if (action === 'share_content') {
      const body = typeof input.body === 'string' ? input.body.trim().slice(0, 5000) : ''
      const url = normalizedUrl(input.url)
      if (!body && !url) return jsonResponse({ message: '?????????' }, 400)

      const { data, error } = await supabase
        .from('shared_contents')
        .insert({ session_id: sessionId, body: body || null, url })
        .select('*')
        .single()
      if (error) throw error
      return jsonResponse({ content: data })
    }

    if (action === 'draw_lottery') {
      const candidateIds = Array.isArray(input.candidateIds)
        ? [...new Set(input.candidateIds.filter((id: unknown) => typeof id === 'string'))].slice(0, 2000)
        : []
      if (!candidateIds.length) return jsonResponse({ message: '?????????' }, 400)

      const [{ data: participants, error: participantError }, { data: priorEvents, error: eventError }] = await Promise.all([
        supabase.from('participants').select('id, name').eq('session_id', sessionId).in('id', candidateIds),
        supabase
          .from('session_events')
          .select('payload')
          .eq('session_id', sessionId)
          .eq('event_type', 'lottery')
          .order('created_at', { ascending: false })
          .limit(5000),
      ])
      if (participantError) throw participantError
      if (eventError) throw eventError

      const candidates = (participants || []) as ParticipantRecord[]
      if (!candidates.length) return jsonResponse({ message: '?????????????' }, 400)

      const latestRound = Math.max(1, ...((priorEvents || []).map((event) => Number(event.payload?.round) || 1)))
      const drawnThisRound = new Set(
        (priorEvents || [])
          .filter((event) => (Number(event.payload?.round) || 1) === latestRound)
          .map((event) => event.payload?.winner_id)
          .filter((id): id is string => typeof id === 'string'),
      )
      let round = latestRound
      let eligible = candidates.filter((participant) => !drawnThisRound.has(participant.id))
      if (!eligible.length) {
        round += 1
        eligible = candidates
      }

      const winner = eligible[randomIndex(eligible.length)]
      const animationPool = shuffled(candidates).slice(0, 39)
      if (!animationPool.some((participant) => participant.id === winner.id)) animationPool.push(winner)
      const orderedPool = shuffled(animationPool)

      const payload = {
        round,
        winner_id: winner.id,
        winner_name: winner.name,
        candidate_count: candidates.length,
        candidate_names: orderedPool.map((participant) => participant.name),
        candidate_ids: orderedPool.map((participant) => participant.id),
        duration_ms: 6000,
        finalized: false,
      }
      const { data: event, error: insertError } = await supabase
        .from('session_events')
        .insert({ session_id: sessionId, event_type: 'lottery', payload })
        .select('*')
        .single()
      if (insertError) throw insertError
      return jsonResponse({ event })
    }

    if (action === 'start_buzzer') {
      const candidateIds = Array.isArray(input.candidateIds)
        ? [...new Set(input.candidateIds.filter((id: unknown) => typeof id === 'string'))].slice(0, 2000)
        : []
      if (!candidateIds.length) return jsonResponse({ message: '?????????' }, 400)

      const [{ data: participants, error: participantError }, { data: priorEvents, error: eventError }] = await Promise.all([
        supabase.from('participants').select('id').eq('session_id', sessionId).in('id', candidateIds),
        supabase
          .from('session_events')
          .select('id, payload')
          .eq('session_id', sessionId)
          .eq('event_type', 'buzzer')
          .order('created_at', { ascending: false })
          .limit(20),
      ])
      if (participantError) throw participantError
      if (eventError) throw eventError

      const eligibleIds = (participants || []).map((participant) => participant.id)
      if (!eligibleIds.length) return jsonResponse({ message: '?????????????' }, 400)

      const finalizedAt = new Date().toISOString()
      await Promise.all(
        (priorEvents || [])
          .filter((event) => event.payload?.finalized !== true)
          .map((event) => supabase
            .from('session_events')
            .update({ payload: { ...event.payload, finalized: true, cancelled: true, finalized_at: finalizedAt } })
            .eq('id', event.id)),
      )

      const payload = {
        candidate_count: eligibleIds.length,
        candidate_ids: eligibleIds,
        started_at: finalizedAt,
        duration_ms: 6000,
        finalized: false,
      }
      const { data: event, error: insertError } = await supabase
        .from('session_events')
        .insert({ session_id: sessionId, event_type: 'buzzer', payload })
        .select('*')
        .single()
      if (insertError) throw insertError
      return jsonResponse({ event })
    }

    if (action === 'select_lottery_winner') {
      const eventId = typeof input.eventId === 'string' ? input.eventId : ''
      const winnerId = typeof input.winnerId === 'string' ? input.winnerId : ''
      if (!eventId || !winnerId) return jsonResponse({ message: '?????????' }, 400)

      const { data: currentEvent, error: eventError } = await supabase
        .from('session_events')
        .select('*')
        .eq('id', eventId)
        .eq('session_id', sessionId)
        .eq('event_type', 'lottery')
        .maybeSingle()
      if (eventError) throw eventError
      if (!currentEvent) return jsonResponse({ message: '????????' }, 404)
      if (currentEvent.payload?.finalized) return jsonResponse({ event: currentEvent })

      const candidateIds = Array.isArray(currentEvent.payload?.candidate_ids)
        ? currentEvent.payload.candidate_ids.filter((id: unknown) => typeof id === 'string')
        : [currentEvent.payload?.winner_id].filter((id: unknown) => typeof id === 'string')
      if (!candidateIds.includes(winnerId)) return jsonResponse({ message: '??????????????' }, 400)

      const { data: winner, error: winnerError } = await supabase
        .from('participants')
        .select('id, name')
        .eq('id', winnerId)
        .eq('session_id', sessionId)
        .maybeSingle()
      if (winnerError) throw winnerError
      if (!winner) return jsonResponse({ message: '?????????' }, 404)

      const payload = {
        ...currentEvent.payload,
        winner_id: winner.id,
        winner_name: winner.name,
        finalized: true,
      }
      const { data: event, error: updateError } = await supabase
        .from('session_events')
        .update({ payload })
        .eq('id', currentEvent.id)
        .select('*')
        .single()
      if (updateError) throw updateError

      const { error: resultEventError } = await supabase
        .from('session_events')
        .insert({ session_id: sessionId, event_type: 'lottery_result', payload })
      if (resultEventError) throw resultEventError

      return jsonResponse({ event })
    }

    return jsonResponse({ message: '?????????' }, 400)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Presenter action failed.'
    console.error('presenter-action failed', detail)
    if (/Only HTTP/.test(detail)) return jsonResponse({ message: '??????????? http ? https?' }, 400)
    return jsonResponse({ message: '?????????????' }, 500)
  }
})
