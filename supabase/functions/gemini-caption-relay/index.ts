// Relays presenter audio to the Gemini Live API and returns caption text.
//
// The browser cannot hold the Gemini key and Live API ephemeral tokens are not
// accepted on the WebSocket endpoint, so the key stays here and the socket is
// proxied. Audio the translation model synthesises is dropped on this side: it
// is billed either way, but there is no reason to push it back to the classroom.
import { getAdminClient, hashPresenterToken } from '../_shared/supabase.ts'

const TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live'
const TRANSLATE_MODEL = 'gemini-3.5-live-translate-preview'
const LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

// Matches the caption languages the app offers. Traditional Chinese is spelled
// out because the model otherwise answers in Simplified.
const languageNames: Record<string, string> = {
  'zh-tw': 'Traditional Chinese as written in Taiwan (臺灣正體, never Simplified characters)',
  en: 'English',
  es: 'Spanish',
  ja: 'Japanese',
  ko: 'Korean',
  vi: 'Vietnamese',
  de: 'German',
  id: 'Indonesian',
  th: 'Thai',
  fr: 'French',
}

// BCP-47 hints for the transcriber. Naming the variety matters for Chinese:
// left to detect the language itself the model answers in Simplified, which is
// wrong for a Taiwanese classroom.
const bcp47: Record<string, string> = {
  'zh-tw': 'cmn-Hant-TW',
  en: 'en-US',
  es: 'es-ES',
  ja: 'ja-JP',
  ko: 'ko-KR',
  vi: 'vi-VN',
  de: 'de-DE',
  id: 'id-ID',
  th: 'th-TH',
  fr: 'fr-FR',
}

function setupFor(mode: string, sourceLanguage: string, targetLanguage: string, resumeHandle: string, raw = false) {
  const source = languageNames[sourceLanguage] || 'the speaker\'s language'
  // A live session is capped at about ten minutes. Resumption lets the next one
  // carry on from where this one stopped instead of starting cold.
  const sessionResumption = resumeHandle ? { handle: resumeHandle } : {}
  if (mode === 'translation') {
    const target = languageNames[targetLanguage] || targetLanguage
    return {
      model: `models/${TRANSLATE_MODEL}`,
      generationConfig: { responseModalities: ['TEXT'] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      sessionResumption,
      systemInstruction: {
        parts: [{
          text: `You are a live classroom interpreter. The speaker is talking in ${source}. `
            + `Render everything they say into ${target}. Output only the interpretation, never commentary.`,
        }],
      },
    }
  }
  const hint = bcp47[sourceLanguage]
  // Asking for 臺灣正體 and letting SMART tidy the grammar turns out to localise
  // vocabulary as well: 視頻 comes back as 影片 and 軟件 as 軟體. That is what a
  // Taiwanese classroom usually wants, but not when the presenter has asked for
  // the transcript as spoken, so that mode keeps the model out of the wording.
  return {
    model: `models/${TRANSCRIBE_MODEL}`,
    inputAudioTranscription: {
      mode: raw ? 'VERBATIM' : 'SMART',
      // Dropping the region subtag in raw mode: cmn-Hant-TW asks for Taiwan, and
      // the model reads that as licence to localise vocabulary, not just script.
      ...(hint ? { languageCodes: [raw ? hint.replace(/-TW$/, '') : hint] } : {}),
    },
    sessionResumption,
    systemInstruction: {
      parts: [{
        text: raw
          ? 'Transcribe exactly what is said. Keep the original wording and terminology; do not substitute regional variants and do not rephrase.'
          : `Transcribe the speaker in ${source}.`,
      }],
    },
  }
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

async function verifyPresenter(sessionId: string, presenterToken: string) {
  if (!sessionId || !presenterToken) return false
  const supabase = getAdminClient()
  const { data } = await supabase
    .from('presenter_session_keys')
    .select('session_id')
    .eq('session_id', sessionId)
    .eq('token_hash', await hashPresenterToken(presenterToken))
    .maybeSingle()
  return Boolean(data)
}

Deno.serve(async (req) => {
  if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
    return new Response('Expected a WebSocket upgrade.', { status: 426 })
  }

  const url = new URL(req.url)
  const sessionId = url.searchParams.get('sessionId') || ''
  const presenterToken = url.searchParams.get('presenterToken') || ''
  const mode = url.searchParams.get('mode') === 'translation' ? 'translation' : 'transcription'
  const sourceLanguage = url.searchParams.get('sourceLanguage') || 'zh-tw'
  const targetLanguage = url.searchParams.get('targetLanguage') || sourceLanguage
  const incomingHandle = url.searchParams.get('resumeHandle') || ''
  const raw = url.searchParams.get('raw') === '1'

  // Checked before the upgrade so an unauthorised caller never reaches Gemini.
  if (!await verifyPresenter(sessionId, presenterToken)) {
    return new Response('講者權限驗證失敗。', { status: 403 })
  }

  const key = Deno.env.get('GEMINI_API_KEY') || ''
  if (!key) return new Response('尚未設定 GEMINI_API_KEY。', { status: 500 })

  const { socket: client, response } = Deno.upgradeWebSocket(req)

  let upstream: WebSocket | null = null
  let upstreamReady = false
  let resumeHandle = incomingHandle
  let finished = false
  let attempts = 0
  // Roughly ten seconds of speech. Audio that arrives while the next session is
  // coming up is held here rather than dropped.
  const pending: ArrayBuffer[] = []

  const tell = (payload: unknown) => {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(payload))
  }

  const sendAudio = (buffer: ArrayBuffer) => {
    upstream?.send(JSON.stringify({
      realtimeInput: {
        audio: { data: bytesToBase64(new Uint8Array(buffer)), mimeType: 'audio/pcm;rate=16000' },
      },
    }))
  }

  // Translation deltas are stitched back into sentences here.
  let sourceBuffer = ''
  let targetBuffer = ''
  let flushTimer = 0

  const flush = () => {
    clearTimeout(flushTimer)
    flushTimer = 0
    if (sourceBuffer.trim()) tell({ type: 'caption', target: false, text: sourceBuffer, final: true })
    if (targetBuffer.trim()) tell({ type: 'caption', target: true, text: targetBuffer, final: true })
    sourceBuffer = ''
    targetBuffer = ''
  }

  // A turn marker is the normal way a sentence ends, but a rotation or a dropped
  // upstream can swallow it; without this the line would never be committed.
  const armFlush = () => {
    clearTimeout(flushTimer)
    flushTimer = setTimeout(flush, 2_000)
  }

  const handleMessage = (message: Record<string, unknown>) => {
    if ('setupComplete' in message) {
      upstreamReady = true
      attempts = 0
      while (pending.length && upstream?.readyState === WebSocket.OPEN) {
        sendAudio(pending.shift() as ArrayBuffer)
      }
      tell({ type: 'ready' })
      return
    }

    // Handed out periodically; the ticket for carrying on after the cap.
    const resumption = message.sessionResumptionUpdate as { newHandle?: string; resumable?: boolean } | undefined
    if (resumption?.newHandle && resumption.resumable !== false) {
      resumeHandle = resumption.newHandle
      tell({ type: 'resume', handle: resumeHandle })
      return
    }

    // Advance warning that this session is about to be cut. Start the next one
    // now so the changeover lands between utterances rather than mid-sentence.
    if (message.goAway) {
      connect()
      return
    }

    const server = message.serverContent as Record<string, unknown> | undefined
    if (!server) {
      if (message.error) tell({ type: 'error', message: String((message.error as { message?: string })?.message || 'Gemini 連線錯誤。') })
      return
    }

    const interim = server.interimInputTranscription as { text?: string } | undefined
    const inputText = server.inputTranscription as { text?: string } | undefined
    const outputText = server.outputTranscription as { text?: string } | undefined

    if (mode === 'translation') {
      // Both sides arrive as deltas here — "Today we're going to learn",
      // " about the three", " stages of photosynthesis." — so each has to be
      // appended. Sending them raw would leave the classroom looking at the
      // last fragment instead of the sentence.
      if (inputText?.text) {
        sourceBuffer += inputText.text
        tell({ type: 'caption', target: false, text: sourceBuffer, final: false })
      }
      if (outputText?.text) {
        targetBuffer += outputText.text
        tell({ type: 'caption', target: true, text: targetBuffer, final: false })
        armFlush()
      }
      if (server.generationComplete || server.turnComplete) flush()
    } else {
      // The transcription model works the other way round: the interim text is
      // the whole utterance so far, and inputTranscription is the finished line.
      if (interim?.text) tell({ type: 'caption', target: false, text: interim.text, final: false })
      if (inputText?.text) tell({ type: 'caption', target: false, text: inputText.text, final: true })
    }
    // serverContent.modelTurn carries synthesised audio; deliberately ignored.
  }

  function connect() {
    if (finished) return
    const previous = upstream
    upstreamReady = false
    attempts += 1

    const next = new WebSocket(`${LIVE_URL}?key=${key}`)
    next.binaryType = 'arraybuffer'
    upstream = next

    next.onopen = () => {
      next.send(JSON.stringify({ setup: setupFor(mode, sourceLanguage, targetLanguage, resumeHandle, raw) }))
      // Only now is the old socket redundant; closing it earlier would lose
      // whatever it was still transcribing.
      if (previous && previous !== next) {
        try { previous.close() } catch { /* already closed */ }
      }
    }
    next.onmessage = async (event) => {
      const raw = typeof event.data === 'string'
        ? event.data
        : new TextDecoder().decode(event.data as ArrayBuffer)
      try {
        handleMessage(JSON.parse(raw))
      } catch {
        // A frame that is not JSON carries nothing this relay needs.
      }
    }
    next.onerror = () => {
      if (upstream === next && !finished) tell({ type: 'error', message: 'Gemini 連線失敗。' })
    }
    next.onclose = () => {
      // A socket replaced by a newer one closing is the expected changeover.
      if (upstream !== next || finished) return
      // A live session is capped, so a close is routine rather than fatal: pick
      // up with the resumption handle instead of tearing the class's captions
      // down. Only a run of immediate failures is worth reporting.
      if (attempts <= 20) {
        setTimeout(connect, Math.min(4000, attempts * 250))
        return
      }
      tell({ type: 'closed' })
      if (client.readyState === WebSocket.OPEN) client.close()
    }
  }

  connect()

  client.onmessage = (event) => {
    if (typeof event.data === 'string') {
      if (event.data === 'end' && upstream?.readyState === WebSocket.OPEN) {
        upstream.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
      }
      return
    }
    const buffer = event.data as ArrayBuffer
    if (!upstreamReady || upstream?.readyState !== WebSocket.OPEN) {
      if (pending.length < 100) pending.push(buffer)
      else pending.shift()
      return
    }
    sendAudio(buffer)
  }

  const shutDown = () => {
    finished = true
    if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
      try { upstream.close() } catch { /* already closed */ }
    }
  }
  client.onclose = shutDown
  client.onerror = shutDown

  return response
})
