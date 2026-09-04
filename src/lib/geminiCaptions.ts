// Live captions through Gemini, used whenever interpretation audio is off.
//
// The OpenAI path hands a MediaStream to WebRTC and the browser does the
// encoding. Gemini's Live API takes raw 16 kHz PCM over a WebSocket instead, so
// the microphone has to be resampled here and pushed frame by frame. The key
// stays on the server: this talks to the gemini-caption-relay function, not to
// Google directly.
import { backendConfig, requireSupabase } from './supabase'

export type GeminiCaptionEvent = {
  language: string
  text: string
  final: boolean
}

type Options = {
  sessionId: string
  presenterToken: string
  mode: 'transcription' | 'translation'
  language: string
  sourceLanguage: string
  stream: MediaStream
  includeSourceEvents?: boolean
  // Ask the transcriber to leave the wording alone. Without it the model
  // localises vocabulary as well as script — 視頻 comes back as 影片.
  raw?: boolean
  onCaption: (event: GeminiCaptionEvent) => void
  onError: (message: string) => void
  onDisconnected?: (message: string) => void
}

const TARGET_RATE = 16000

// Served as a plain file rather than imported: Vite inlines a small asset as a
// data: URL, and the app's CSP allows scripts from 'self' only, so both a blob
// and a data URL are refused. BASE_URL keeps it correct under the app's own
// origin and under the /InterAct/ path the student build is served from.
const workletUrl = new URL('caption-worklet.js', new URL(import.meta.env.BASE_URL, window.location.href)).toString()

// Measured: the platform kills the relay a little after a minute, with no close
// frame. Rotating well before that keeps the changeover under our control
// instead of arriving as a dropped connection mid-sentence.
const ROTATE_AFTER_MS = 50_000

function relayUrl(options: Options, resumeHandle: string) {
  const base = backendConfig?.url
  if (!base) throw new Error('尚未設定後端專案。')
  const url = new URL(`${base}/functions/v1/gemini-caption-relay`)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('sessionId', options.sessionId)
  url.searchParams.set('presenterToken', options.presenterToken)
  url.searchParams.set('mode', options.mode)
  url.searchParams.set('sourceLanguage', options.sourceLanguage)
  url.searchParams.set('targetLanguage', options.language)
  url.searchParams.set('apikey', backendConfig?.key || '')
  if (options.raw) url.searchParams.set('raw', '1')
  // Carries the Gemini session across relays, so a rotation does not read as a
  // new speaker starting mid-lesson.
  if (resumeHandle) url.searchParams.set('resumeHandle', resumeHandle)
  return url.toString()
}

export async function createGeminiCaptionConnection(options: Options): Promise<{ close: () => void }> {
  // Fails early and with a real message if the relay was never deployed.
  const probe = await requireSupabase().functions.invoke('gemini-caption-relay', { body: {} }).catch(() => null)
  if (probe?.error && /not found/i.test(String(probe.error.message || ''))) {
    throw new Error('後端缺少 gemini-caption-relay，請到系統設定重新執行自動部署。')
  }

  const audioContext = new AudioContext()
  let worklet: AudioWorkletNode | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let closed = false

  // Two relays overlap during a changeover: audio keeps going to the one that
  // is working while the replacement finishes its handshake.
  let active: WebSocket | null = null
  let rotateTimer = 0
  let resumeHandle = ''
  let failures = 0

  const cleanup = () => {
    if (closed) return
    closed = true
    window.clearTimeout(rotateTimer)
    try { worklet?.port.close() } catch { /* already gone */ }
    worklet?.disconnect()
    source?.disconnect()
    void audioContext.close().catch(() => { /* already closing */ })
    if (active && (active.readyState === WebSocket.OPEN || active.readyState === WebSocket.CONNECTING)) active.close()
  }

  const openRelay = (): Promise<WebSocket> => new Promise((resolve, reject) => {
    const socket = new WebSocket(relayUrl(options, resumeHandle))
    socket.binaryType = 'arraybuffer'
    let settled = false

    socket.addEventListener('message', (event) => {
      let payload: Record<string, unknown>
      try {
        payload = JSON.parse(typeof event.data === 'string' ? event.data : '')
      } catch {
        return
      }
      const type = payload.type
      if (type === 'ready') {
        if (!settled) { settled = true; resolve(socket) }
        return
      }
      // Kept here rather than in the relay, which does not outlive a rotation.
      if (type === 'resume') { resumeHandle = String(payload.handle || ''); return }
      if (type === 'error') { options.onError(String(payload.message || 'Gemini 字幕發生錯誤。')); return }
      if (type !== 'caption') return
      // Only the socket currently carrying audio may speak, or a relay that is
      // being retired would keep emitting stale lines.
      if (socket !== active) return

      const isTarget = payload.target === true
      // In translation mode the source line belongs to the other connection,
      // which is already transcribing it; emitting it twice would double up.
      if (!isTarget && options.mode === 'translation' && !options.includeSourceEvents) return
      const text = String(payload.text || '').trim()
      if (!text) return
      options.onCaption({
        language: isTarget ? options.language : options.sourceLanguage,
        text,
        final: payload.final === true,
      })
    })

    socket.addEventListener('close', () => {
      if (!settled) { settled = true; reject(new Error('即時字幕連線中斷。')) }
      // The platform kills a relay after about a minute without a close frame,
      // so an unexpected close is routine: bring the next one up immediately
      // rather than telling the presenter anything went wrong.
      if (socket === active && !closed) void rotate(true)
    })

    window.setTimeout(() => {
      if (settled) return
      settled = true
      try { socket.close() } catch { /* already closing */ }
      reject(new Error('即時字幕連線逾時。'))
    }, 15_000)
  })

  async function rotate(immediate = false) {
    if (closed) return
    window.clearTimeout(rotateTimer)
    try {
      const next = await openRelay()
      if (closed) { next.close(); return }
      const previous = active
      active = next
      failures = 0
      // Retired only once its replacement is answering, so no speech is lost.
      if (previous && previous !== next) {
        try { previous.close() } catch { /* already closed */ }
      }
      rotateTimer = window.setTimeout(() => void rotate(), ROTATE_AFTER_MS)
    } catch (error) {
      failures += 1
      if (closed) return
      if (failures >= 5) {
        options.onDisconnected?.(error instanceof Error ? error.message : '即時字幕連線中斷。')
        return
      }
      rotateTimer = window.setTimeout(() => void rotate(true), immediate ? 500 * failures : 2_000)
    }
  }

  // The first relay is awaited so a misconfigured backend fails the start of
  // recording rather than silently producing no captions.
  active = await openRelay()
  rotateTimer = window.setTimeout(() => void rotate(), ROTATE_AFTER_MS)

  try {
    await audioContext.audioWorklet.addModule(workletUrl)
    source = audioContext.createMediaStreamSource(options.stream)
    worklet = new AudioWorkletNode(audioContext, 'caption-downsampler', {
      processorOptions: { targetRate: TARGET_RATE },
    })
    worklet.port.onmessage = (message) => {
      if (closed || active?.readyState !== WebSocket.OPEN) return
      active.send(message.data as ArrayBuffer)
    }
    source.connect(worklet)
    // Keeps the graph pulling without putting the microphone on the speakers.
    const sink = audioContext.createGain()
    sink.gain.value = 0
    worklet.connect(sink).connect(audioContext.destination)
  } catch (error) {
    cleanup()
    throw error instanceof Error ? error : new Error('無法啟動音訊擷取。')
  }

  return { close: cleanup }
}
