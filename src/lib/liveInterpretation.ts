import type { RealtimeChannel } from '@supabase/supabase-js'
import { requireSupabase } from './supabase'

const CHUNK_DURATION_MS = 250
const AUDIO_PACKET_HEADER_BYTES = 8

export type InterpretationAudioBroadcaster = {
  close: () => void
}

type MediaStreamTrackProcessorLike = {
  readable: ReadableStream<AudioData>
}

type MediaStreamTrackProcessorConstructor = new (options: { track: MediaStreamTrack }) => MediaStreamTrackProcessorLike

function encodePcm16(samples: Float32Array, sampleRate: number) {
  const buffer = new ArrayBuffer(AUDIO_PACKET_HEADER_BYTES + samples.length * 2)
  const view = new DataView(buffer)
  // IAP1 (InterAct Audio Packet v1), followed by the little-endian sample rate.
  view.setUint8(0, 0x49)
  view.setUint8(1, 0x41)
  view.setUint8(2, 0x50)
  view.setUint8(3, 0x31)
  view.setUint32(4, sampleRate, true)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(AUDIO_PACKET_HEADER_BYTES + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
}

function waitForSubscription(channel: RealtimeChannel) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('即時口譯廣播連線逾時。')), 8000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        window.clearTimeout(timeout)
        resolve()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        window.clearTimeout(timeout)
        reject(new Error('無法連接即時口譯廣播。'))
      }
    })
  })
}

export async function createInterpretationAudioBroadcaster(
  sessionId: string,
  language: string,
  stream: MediaStream,
  audioContext: AudioContext,
  onError: (message: string) => void,
): Promise<InterpretationAudioBroadcaster> {
  const supabase = requireSupabase()
  const channel = supabase.channel(`interpretation-audio:${sessionId}:${language}`, {
    config: { broadcast: { ack: true } },
  })
  try {
    await waitForSubscription(channel)
  } catch (error) {
    void supabase.removeChannel(channel)
    throw error
  }

  let closed = false
  let source: MediaStreamAudioSourceNode | null = null
  let processor: ScriptProcessorNode | null = null
  let silentOutput: GainNode | null = null
  let frameReader: ReadableStreamDefaultReader<AudioData> | null = null
  let pendingSamples: number[] = []
  let pendingSampleRate = 0
  let sendQueue = Promise.resolve()

  const sendChunk = (samples: Float32Array, sampleRate: number) => {
    sendQueue = sendQueue.then(async () => {
      const result = await channel.send({
        type: 'broadcast',
        event: 'audio',
        payload: encodePcm16(samples, sampleRate),
      })
      if (result !== 'ok') throw new Error('即時口譯音訊送出失敗。')
    }).catch((error: unknown) => onError(error instanceof Error ? error.message : '即時口譯音訊送出失敗。'))
  }

  const appendSamples = (channels: Float32Array[], sampleRate: number) => {
    if (closed || !channels.length) return
    if (pendingSampleRate && pendingSampleRate !== sampleRate) pendingSamples = []
    pendingSampleRate = sampleRate
    for (let sampleIndex = 0; sampleIndex < channels[0].length; sampleIndex += 1) {
      let mixed = 0
      for (const channelSamples of channels) mixed += channelSamples[sampleIndex]
      pendingSamples.push(mixed / channels.length)
    }
    const samplesPerChunk = Math.round(sampleRate * CHUNK_DURATION_MS / 1000)
    while (pendingSamples.length >= samplesPerChunk) {
      sendChunk(Float32Array.from(pendingSamples.splice(0, samplesPerChunk)), sampleRate)
    }
  }

  const startWebAudioFallback = async () => {
    if (closed || source) return
    if (audioContext.state !== 'running') await audioContext.resume()
    if (audioContext.state !== 'running') throw new Error('教師端的音訊處理尚未啟動，請關閉後重新開啟課程錄製。')
    source = audioContext.createMediaStreamSource(stream)
    processor = audioContext.createScriptProcessor(4096, 1, 1)
    silentOutput = audioContext.createGain()
    // Keep Chromium's audio graph active without making the interpreted track audible locally.
    silentOutput.gain.value = 0.000001
    source.connect(processor)
    processor.connect(silentOutput)
    silentOutput.connect(audioContext.destination)
    processor.addEventListener('audioprocess', (event) => {
      if (closed || !stream.active) return
      const input = event.inputBuffer
      appendSamples(
        Array.from({ length: input.numberOfChannels }, (_, index) => input.getChannelData(index)),
        audioContext.sampleRate,
      )
    })
  }

  const track = stream.getAudioTracks()[0]
  if (!track) {
    void supabase.removeChannel(channel)
    throw new Error('OpenAI 沒有提供即時口譯音軌。')
  }
  const TrackProcessor = (globalThis as typeof globalThis & {
    MediaStreamTrackProcessor?: MediaStreamTrackProcessorConstructor
  }).MediaStreamTrackProcessor
  if (TrackProcessor) {
    frameReader = new TrackProcessor({ track }).readable.getReader()
    void (async () => {
      try {
        while (!closed && frameReader) {
          const { done, value } = await frameReader.read()
          if (done) break
          try {
            const channels = Array.from({ length: value.numberOfChannels }, (_, channelIndex) => {
              const samples = new Float32Array(value.numberOfFrames)
              value.copyTo(samples, { format: 'f32-planar', planeIndex: channelIndex })
              return samples
            })
            appendSamples(channels, value.sampleRate)
          } finally {
            value.close()
          }
        }
      } catch (error) {
        if (closed) return
        try {
          frameReader = null
          await startWebAudioFallback()
        } catch {
          onError(error instanceof Error ? error.message : '即時口譯音訊讀取失敗。')
        }
      }
    })()
  } else {
    try {
      await startWebAudioFallback()
    } catch (error) {
      void supabase.removeChannel(channel)
      throw error
    }
  }

  return {
    close() {
      if (closed) return
      closed = true
      pendingSamples = []
      void frameReader?.cancel()
      frameReader = null
      source?.disconnect()
      processor?.disconnect()
      silentOutput?.disconnect()
      void supabase.removeChannel(channel)
    },
  }
}
