import { requireSupabase } from './supabase'

export type LiveCaptionEvent = {
  language: string
  text: string
  final: boolean
}

type RealtimeCaptionConnection = {
  close: () => void
}

type ConnectionOptions = {
  sessionId: string
  presenterToken: string
  mode: 'transcription' | 'translation'
  language: string
  stream: MediaStream
  includeSourceEvents?: boolean
  sourceLanguage: string
  onCaption: (event: LiveCaptionEvent) => void
  onTranslatedAudio?: (stream: MediaStream) => void
  onError: (message: string) => void
  onDisconnected?: (message: string) => void
}

function eventText(event: Record<string, unknown>) {
  const value = event.delta ?? event.transcript ?? event.text
  return typeof value === 'string' ? value : ''
}

function realtimeErrorMessage(event: Record<string, unknown>) {
  const detail = event.error && typeof event.error === 'object'
    ? (event.error as Record<string, unknown>).message
    : undefined
  if (typeof detail !== 'string') return '即時字幕服務回報錯誤。'
  if (detail.includes('no credits remaining')) return 'OpenAI API 額度已用完，請儲值後再重新啟動字幕。'
  return detail
}

function readableServiceError(detail: string) {
  if (detail.includes('no credits remaining') || detail.includes('credit_balance_exhausted')) {
    return 'OpenAI API 額度已用完；ChatGPT 訂閱不包含 API 點數，請確認儲值的是這支 API key 所屬的 Organization。'
  }
  if (detail.includes('<!DOCTYPE html') || detail.includes('<html')) {
    return 'OpenAI 即時字幕服務暫時無法連線。'
  }
  try {
    const parsed = JSON.parse(detail)
    const message = parsed?.error?.message
    return typeof message === 'string' ? message : detail
  } catch {
    return detail
  }
}

async function directRealtimeError(response: Response) {
  const detail = await response.text()
  return readableServiceError(detail)
}

async function functionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return '即時字幕服務連線失敗。'
  const response = (error as Error & { context?: Response }).context
  if (response) {
    try {
      const body = await response.clone().json()
      if (typeof body?.detail === 'string') return readableServiceError(body.detail)
      if (typeof body?.message === 'string') return readableServiceError(body.message)
    } catch {
      // Fall through to the SDK error message.
    }
  }
  return error.message
}

export async function createRealtimeCaptionConnection(options: ConnectionOptions): Promise<RealtimeCaptionConnection> {
  const peer = new RTCPeerConnection()
  const dataChannel = peer.createDataChannel('oai-events')
  const translatedAudioElements: HTMLAudioElement[] = []
  let stopLocalTurnDetection = () => {}
  let closed = false
  let disconnectTimer: number | null = null
  let disconnectReported = false
  const reportDisconnected = (message: string, delay = 0) => {
    if (closed || disconnectReported || disconnectTimer !== null) return
    disconnectTimer = window.setTimeout(() => {
      disconnectTimer = null
      if (closed || disconnectReported || peer.connectionState === 'connected') return
      disconnectReported = true
      options.onDisconnected?.(message)
    }, delay)
  }
  const clearDisconnectTimer = () => {
    if (disconnectTimer !== null) window.clearTimeout(disconnectTimer)
    disconnectTimer = null
  }
  for (const track of options.stream.getAudioTracks()) peer.addTrack(track, options.stream)
  if (options.mode === 'translation' && options.onTranslatedAudio) {
    peer.addEventListener('track', ({ track, streams }) => {
      const translatedStream = streams[0] || new MediaStream([track])
      track.enabled = true
      const translatedAudio = new Audio()
      translatedAudio.autoplay = true
      translatedAudio.muted = true
      translatedAudio.srcObject = translatedStream
      translatedAudioElements.push(translatedAudio)
      void translatedAudio.play().catch(() => {
        // MediaStreamTrackProcessor remains the primary capture path in the desktop app.
      })
      options.onTranslatedAudio?.(translatedStream)
    }, { once: true })
  }

  const buffers = new Map<string, string>()
  const finalizeTimers = new Map<string, number>()
  const emit = (language: string, text: string, final: boolean) => {
    const normalized = text.trim()
    if (normalized) options.onCaption({ language, text: normalized, final })
  }

  dataChannel.addEventListener('message', (message) => {
    try {
      const event = JSON.parse(message.data) as Record<string, unknown>
      const type = typeof event.type === 'string' ? event.type : ''
      if (type === 'error' || type.endsWith('.failed')) {
        options.onError(realtimeErrorMessage(event))
        return
      }
      const isTranscription = type.includes('input_audio_transcription')
      const isTranslationSource = type.startsWith('session.input_transcript.')
      const isTranslationOutput = type.startsWith('session.output_transcript.')
      if (!isTranscription && !isTranslationSource && !isTranslationOutput) return
      if (isTranslationSource && !options.includeSourceEvents) return

      const language = isTranslationOutput ? options.language : options.sourceLanguage
      const itemId = typeof event.item_id === 'string' ? event.item_id : ''
      const key = `${type.split('.').slice(0, -1).join('.')}:${language}:${itemId}`
      const text = eventText(event)
      if (type.endsWith('.delta')) {
        const next = `${buffers.get(key) || ''}${text}`
        buffers.set(key, next)
        emit(language, next, false)
        if (isTranslationSource || isTranslationOutput) {
          window.clearTimeout(finalizeTimers.get(key))
          finalizeTimers.set(key, window.setTimeout(() => {
            const finalText = buffers.get(key) || ''
            buffers.delete(key)
            finalizeTimers.delete(key)
            emit(language, finalText, true)
          }, 1200))
        }
      } else if (type.endsWith('.completed') || type.endsWith('.done')) {
        window.clearTimeout(finalizeTimers.get(key))
        finalizeTimers.delete(key)
        const finalText = text || buffers.get(key) || ''
        buffers.delete(key)
        emit(language, finalText, true)
      }
    } catch {
      // Ignore non-JSON WebRTC messages.
    }
  })
  dataChannel.addEventListener('error', () => reportDisconnected('即時字幕資料連線發生錯誤。'))
  dataChannel.addEventListener('close', () => reportDisconnected('即時字幕資料連線已關閉。'))
  peer.addEventListener('connectionstatechange', () => {
    if (peer.connectionState === 'connected') {
      clearDisconnectTimer()
      return
    }
    if (peer.connectionState === 'disconnected') {
      reportDisconnected('即時字幕音訊連線中斷。', 5_000)
      return
    }
    if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
      reportDisconnected('即時字幕音訊連線中斷。')
    }
  })

  const offer = await peer.createOffer()
  await peer.setLocalDescription(offer)
  const { data, error } = await requireSupabase().functions.invoke('openai-realtime-session', {
    body: {
      sessionId: options.sessionId,
      presenterToken: options.presenterToken,
      mode: options.mode,
      targetLanguage: options.mode === 'translation' ? options.language : undefined,
      sdp: offer.sdp,
    },
    timeout: 15_000,
  })
  if (error) {
    peer.close()
    throw new Error(await functionErrorMessage(error))
  }
  if (options.mode === 'transcription' && data?.clientSecret) {
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${data.clientSecret}`,
        'Content-Type': 'application/sdp',
      },
      body: offer.sdp,
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) {
      const message = await directRealtimeError(response)
      peer.close()
      throw new Error(message)
    }
    const answerSdp = await response.text()
    await peer.setRemoteDescription({ type: 'answer', sdp: answerSdp })

    try {
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(options.stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 2048
      source.connect(analyser)
      const samples = new Float32Array(analyser.fftSize)
      let speechDetected = false
      let speechStartedAt = 0
      let lastSpeechAt = 0
      const detector = window.setInterval(() => {
        analyser.getFloatTimeDomainData(samples)
        let energy = 0
        for (const sample of samples) energy += sample * sample
        const now = performance.now()
        if (Math.sqrt(energy / samples.length) >= 0.012) {
          if (!speechDetected) speechStartedAt = now
          speechDetected = true
          lastSpeechAt = now
        }
        const paused = speechDetected && now - lastSpeechAt >= 550
        const longSegment = speechDetected && now - speechStartedAt >= 6000
        if ((paused || longSegment) && dataChannel.readyState === 'open') {
          dataChannel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
          speechDetected = false
        }
      }, 100)
      void audioContext.resume().catch(() => {})
      stopLocalTurnDetection = () => {
        window.clearInterval(detector)
        source.disconnect()
        analyser.disconnect()
        void audioContext.close()
      }
    } catch {
      // The realtime delta stream still works if local audio analysis is unavailable.
    }
  } else {
    if (!data?.sdp) {
      peer.close()
      throw new Error(data?.message || '沒有取得即時字幕連線。')
    }
    await peer.setRemoteDescription({ type: 'answer', sdp: data.sdp })
  }

  return {
    close() {
      closed = true
      clearDisconnectTimer()
      stopLocalTurnDetection()
      for (const timer of finalizeTimers.values()) window.clearTimeout(timer)
      for (const audio of translatedAudioElements) {
        audio.pause()
        audio.srcObject = null
      }
      dataChannel.close()
      peer.close()
    },
  }
}
