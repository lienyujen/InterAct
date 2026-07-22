import { corsHeaders, jsonResponse } from '../_shared/ai.ts'
import { getAdminClient } from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405)

  try {
    const input = await req.json()
    const action = typeof input.action === 'string' ? input.action : ''
    const sessionId = typeof input.sessionId === 'string' ? input.sessionId : ''
    const participantId = typeof input.participantId === 'string' ? input.participantId : ''
    if (action !== 'claim_buzzer' || !sessionId || !participantId) {
      return jsonResponse({ message: '?????????' }, 400)
    }

    const eventId = typeof input.eventId === 'string' ? input.eventId : ''
    if (!eventId) return jsonResponse({ message: '????????' }, 400)

    const supabase = getAdminClient()
    const { data: participant, error: participantError } = await supabase
      .from('participants')
      .select('id')
      .eq('id', participantId)
      .eq('session_id', sessionId)
      .maybeSingle()
    if (participantError) throw participantError
    if (!participant) return jsonResponse({ message: '????????' }, 404)

    const { data, error } = await supabase.rpc('claim_buzzer', {
      p_event_id: eventId,
      p_session_id: sessionId,
      p_participant_id: participantId,
    })
    if (error) throw error

    const event = Array.isArray(data) ? data[0] : data
    if (!event) return jsonResponse({ message: '????????' }, 404)
    return jsonResponse({ event, won: event.payload?.winner_id === participantId })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Participant action failed.'
    console.error('participant-action failed', detail)
    return jsonResponse({ message: '???????????' }, 500)
  }
})
