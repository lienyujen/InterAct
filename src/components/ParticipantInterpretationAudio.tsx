import { Headphones, Pause, Play, Volume2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { captionLanguageLabel } from '../lib/captionLanguages'
import { requireSupabase } from '../lib/supabase'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'

type Props = {
  enabled: boolean
  languages: string[]
  sessionId: string
  locale?: ParticipantLocale
}

type AudioPacket = {
  bytes: ArrayBuffer
  encoding: string
  sampleRate: number
}

const AUDIO_PACKET_HEADER_BYTES = 8

function binaryAudioPacket(bytes: ArrayBuffer): AudioPacket {
  if (bytes.byteLength >= AUDIO_PACKET_HEADER_BYTES) {
    const header = new DataView(bytes)
    const isInterActPcm = header.getUint8(0) === 0x49
      && header.getUint8(1) === 0x41
      && header.getUint8(2) === 0x50
      && header.getUint8(3) === 0x31
    if (isInterActPcm) {
      const sampleRate = header.getUint32(4, true)
      return {
        bytes: bytes.slice(AUDIO_PACKET_HEADER_BYTES),
        encoding: 'pcm16le',
        sampleRate: sampleRate >= 8_000 && sampleRate <= 96_000 ? sampleRate : 24_000,
      }
    }
  }
  return { bytes, encoding: 'encoded', sampleRate: 24_000 }
}

function base64ToArrayBuffer(encoded: string) {
  const binary = window.atob(encoded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function extractAudioPacket(value: unknown): AudioPacket | null {
  if (value instanceof ArrayBuffer) return binaryAudioPacket(value)
  if (ArrayBuffer.isView(value)) {
    return binaryAudioPacket(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer)
  }
  if (value && typeof value === 'object' && 'payload' in value) {
    return extractAudioPacket((value as { payload: unknown }).payload)
  }
  if (value && typeof value === 'object' && 'audioBase64' in value) {
    const packet = value as { audioBase64?: unknown; encoding?: unknown; sampleRate?: unknown }
    const encoded = packet.audioBase64
    if (typeof encoded !== 'string' || !encoded) return null
    try {
      return {
        bytes: base64ToArrayBuffer(encoded),
        encoding: typeof packet.encoding === 'string' ? packet.encoding : 'encoded',
        sampleRate: typeof packet.sampleRate === 'number' && packet.sampleRate >= 8_000 && packet.sampleRate <= 96_000
          ? packet.sampleRate
          : 24_000,
      }
    } catch {
      return null
    }
  }
  return null
}

function pcm16AudioBuffer(context: AudioContext, packet: AudioPacket) {
  const view = new DataView(packet.bytes)
  const sampleCount = Math.floor(packet.bytes.byteLength / 2)
  const buffer = context.createBuffer(1, sampleCount, packet.sampleRate)
  const samples = buffer.getChannelData(0)
  let squareSum = 0
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = view.getInt16(index * 2, true) / 0x8000
    samples[index] = sample
    squareSum += sample * sample
  }
  return { buffer, rms: sampleCount ? Math.sqrt(squareSum / sampleCount) : 0 }
}

export function ParticipantInterpretationAudio({ enabled, languages, sessionId, locale = 'zh-TW' }: Props) {
  const [language, setLanguage] = useState(() => localStorage.getItem(`interact_interpretation_language_${sessionId}`) || languages[0] || '')
  const [listening, setListening] = useState(false)
  const [status, setStatus] = useState('')
  const audioContextRef = useRef<AudioContext | null>(null)
  const outputGainRef = useRef<GainNode | null>(null)
  const nextPlaybackAtRef = useRef(0)

  useEffect(() => {
    if (!languages.includes(language)) setLanguage(languages[0] || '')
  }, [language, languages])

  useEffect(() => {
    if (!enabled) setListening(false)
  }, [enabled])

  useEffect(() => {
    if (!listening || !enabled || !language) return
    const supabase = requireSupabase()
    const context = audioContextRef.current || new AudioContext()
    audioContextRef.current = context
    const outputGain = outputGainRef.current || context.createGain()
    if (!outputGainRef.current) {
      outputGain.gain.value = 1.35
      outputGain.connect(context.destination)
      outputGainRef.current = outputGain
    }
    nextPlaybackAtRef.current = context.currentTime
    setStatus(participantText(locale, 'connecting'))

    const channel = supabase
      .channel(`interpretation-audio:${sessionId}:${language}`)
      .on('broadcast', { event: 'audio' }, (message) => {
        const packet = extractAudioPacket(message)
        if (!packet) return
        const decoded = packet.encoding === 'pcm16le'
          ? Promise.resolve(pcm16AudioBuffer(context, packet))
          : context.decodeAudioData(packet.bytes.slice(0)).then((buffer) => ({ buffer, rms: 1 }))
        void decoded.then(async ({ buffer, rms }) => {
          if (context.state !== 'running') await context.resume()
          if (context.state !== 'running') throw new Error('AudioContext is suspended')
          if (rms < 0.0005) {
            setStatus(participantText(locale, 'waitingTeacher'))
            return
          }
          const source = context.createBufferSource()
          source.buffer = buffer
          source.connect(outputGain)
          const lag = nextPlaybackAtRef.current - context.currentTime
          if (lag > 5 || lag < -0.5) nextPlaybackAtRef.current = context.currentTime + 0.08
          const startsAt = Math.max(context.currentTime + 0.04, nextPlaybackAtRef.current)
          source.start(startsAt)
          nextPlaybackAtRef.current = startsAt + buffer.duration
          setStatus(participantText(locale, 'playing'))
        }).catch(() => setStatus(participantText(locale, 'audioNotEnabled')))
      })
      .subscribe((nextStatus) => {
        if (nextStatus === 'SUBSCRIBED') setStatus(participantText(locale, 'waitingTeacher'))
        if (nextStatus === 'CHANNEL_ERROR' || nextStatus === 'TIMED_OUT') setStatus(participantText(locale, 'connectionFailed'))
      })

    return () => {
      void supabase.removeChannel(channel)
      nextPlaybackAtRef.current = 0
    }
  }, [enabled, language, listening, locale, sessionId])

  useEffect(() => () => {
    void audioContextRef.current?.close()
  }, [])

  async function toggleListening() {
    if (listening) {
      setListening(false)
      setStatus('')
      return
    }
    const context = audioContextRef.current || new AudioContext()
    audioContextRef.current = context
    if (!outputGainRef.current) {
      outputGainRef.current = context.createGain()
      outputGainRef.current.gain.value = 1.35
      outputGainRef.current.connect(context.destination)
    }
    await context.resume()
    setListening(true)
  }

  async function testHeadphones() {
    const context = audioContextRef.current || new AudioContext()
    audioContextRef.current = context
    const outputGain = outputGainRef.current || context.createGain()
    if (!outputGainRef.current) {
      outputGain.gain.value = 1.35
      outputGain.connect(context.destination)
      outputGainRef.current = outputGain
    }
    await context.resume()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.frequency.value = 660
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.28)
    oscillator.connect(gain)
    gain.connect(outputGain)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.3)
    setStatus(participantText(locale, 'testPlayed'))
  }

  if (!enabled || !languages.length) return null

  return (
    <section className="panel participant-interpretation-audio">
      <div className="participant-interpretation-heading">
        <span><Headphones size={19} />{participantText(locale, 'interpretation')}</span>
        <button
          aria-label={participantText(locale, 'testHeadphones')}
          className={`interpretation-speaker-test${listening ? ' is-listening' : ''}`}
          title={participantText(locale, 'testHeadphones')}
          type="button"
          onClick={() => void testHeadphones()}
        >
          <Volume2 className="interpretation-playing-icon" size={18} />
        </button>
      </div>
      <label>
        {participantText(locale, 'headphoneLanguage')}
        {languages.length > 2 ? (
          <select disabled={listening} value={language} onChange={(event) => {
            setLanguage(event.target.value)
            localStorage.setItem(`interact_interpretation_language_${sessionId}`, event.target.value)
          }}>
            {languages.map((code) => <option key={code} value={code}>{captionLanguageLabel(code)}</option>)}
          </select>
        ) : (
          <span className="interpretation-language-buttons">
            {languages.map((code) => (
              <button
                aria-pressed={language === code}
                className={language === code ? 'is-active' : 'ghost-button'}
                disabled={listening}
                key={code}
                type="button"
                onClick={() => {
                  setLanguage(code)
                  localStorage.setItem(`interact_interpretation_language_${sessionId}`, code)
                }}
              >
                {captionLanguageLabel(code)}
              </button>
            ))}
          </span>
        )}
      </label>
      <button className={listening ? 'ghost-button' : ''} type="button" onClick={() => void toggleListening()}>
        {listening ? <><Pause size={17} />{participantText(locale, 'stopListening')}</> : <><Play size={17} />{participantText(locale, 'startListening')}</>}
      </button>
      <p className="muted">{status || participantText(locale, 'headphoneHint')}</p>
    </section>
  )
}
