import { Languages, Mic, RefreshCw, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { CAPTION_DISPLAY_LANGUAGES, INTERPRETATION_LANGUAGES, SPEAKER_LANGUAGES, defaultInterpretationLanguages } from '../lib/captionLanguages'
import type { Session } from '../types'

export type PresenterCaptionSettings = {
  sourceLanguage: string
  displayLanguage: string
  fontSize: number
  fontBold: boolean
  position: 'top' | 'center' | 'bottom'
  interpretationAudioEnabled: boolean
  interpretationLanguages: string[]
}

type Props = {
  busy: boolean
  error: string
  microphones: MediaDeviceInfo[]
  open: boolean
  selectedMicrophoneId: string
  session: Session
  onClose: () => void
  onRefreshMicrophones: () => void
  onSave: (settings: PresenterCaptionSettings, microphoneId: string) => void
}

export function PresenterSettingsModal({
  busy,
  error,
  microphones,
  open,
  selectedMicrophoneId,
  session,
  onClose,
  onRefreshMicrophones,
  onSave,
}: Props) {
  const [sourceLanguage, setSourceLanguage] = useState(session.caption_source_language)
  const [displayLanguage, setDisplayLanguage] = useState(session.caption_display_language)
  const [fontSize, setFontSize] = useState(session.caption_font_size ?? 36)
  const [fontBold, setFontBold] = useState(session.caption_font_bold ?? false)
  const [position, setPosition] = useState(session.caption_position ?? 'bottom')
  const [interpretationAudioEnabled, setInterpretationAudioEnabled] = useState(session.interpretation_audio_enabled)
  const [interpretationLanguages, setInterpretationLanguages] = useState(session.interpretation_languages)
  const [microphoneId, setMicrophoneId] = useState(selectedMicrophoneId)
  const [microphoneLevel, setMicrophoneLevel] = useState(0)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    if (!open) return
    setSourceLanguage(session.caption_source_language)
    setDisplayLanguage(session.caption_display_language)
    setFontSize(session.caption_font_size ?? 36)
    setFontBold(session.caption_font_bold ?? false)
    setPosition(session.caption_position ?? 'bottom')
    setInterpretationAudioEnabled(session.interpretation_audio_enabled)
    setInterpretationLanguages(session.interpretation_languages)
    setMicrophoneId(selectedMicrophoneId)
  }, [open, selectedMicrophoneId, session])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let animationFrame = 0
    let audioContext: AudioContext | null = null
    let stream: MediaStream | null = null

    void navigator.mediaDevices.getUserMedia({
      audio: {
        ...(microphoneId ? { deviceId: { exact: microphoneId } } : {}),
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    }).then((nextStream) => {
      if (cancelled) {
        nextStream.getTracks().forEach((track) => track.stop())
        return
      }
      stream = nextStream
      setPreviewError('')
      audioContext = new AudioContext()
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 512
      audioContext.createMediaStreamSource(nextStream).connect(analyser)
      const samples = new Uint8Array(analyser.fftSize)
      const updateLevel = () => {
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) {
          const centered = (sample - 128) / 128
          sum += centered * centered
        }
        const rms = Math.sqrt(sum / samples.length)
        setMicrophoneLevel(Math.min(100, Math.round(rms * 420)))
        animationFrame = requestAnimationFrame(updateLevel)
      }
      updateLevel()
    }).catch((reason: unknown) => {
      setMicrophoneLevel(0)
      setPreviewError(reason instanceof Error ? reason.message : '無法讀取麥克風。')
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(animationFrame)
      stream?.getTracks().forEach((track) => track.stop())
      void audioContext?.close()
    }
  }, [microphoneId, open])

  const availableInterpretationLanguages = useMemo(
    () => INTERPRETATION_LANGUAGES.filter((language) => language.code !== sourceLanguage),
    [sourceLanguage],
  )

  if (!open) return null

  function submit(event: FormEvent) {
    event.preventDefault()
    onSave({ sourceLanguage, displayLanguage, fontSize, fontBold, position, interpretationAudioEnabled, interpretationLanguages }, microphoneId)
  }

  return (
    <div className="modal-backdrop presenter-settings-backdrop" role="presentation">
      <form className="modal presenter-settings-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <h2><Settings size={20} />教師端設定</h2>
            <p className="muted">設定課程錄製、字幕外觀與學生端即時口譯語音</p>
          </div>
          <button className="ghost-button icon-button" aria-label="關閉設定" title="關閉" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <section className="presenter-settings-section">
          <div className="presenter-settings-section-heading">
            <span><Mic size={17} />麥克風</span>
            <button className="ghost-button settings-refresh-button" type="button" onClick={onRefreshMicrophones} disabled={busy}>
              <RefreshCw size={15} />重新掃描
            </button>
          </div>
          <label>
            課程錄製音訊來源
            <select value={microphoneId} onChange={(event) => setMicrophoneId(event.target.value)}>
              <option value="">系統預設麥克風</option>
              {microphones
                .filter((device) => device.deviceId !== 'default')
                .map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>{device.label || `麥克風 ${index + 1}`}</option>
                ))}
            </select>
          </label>
          <div className="microphone-meter-row">
            <span>輸入音量</span>
            <div className="microphone-meter" role="meter" aria-label="麥克風輸入音量" aria-valuemin={0} aria-valuemax={100} aria-valuenow={microphoneLevel}>
              <span style={{ width: `${microphoneLevel}%` }} />
            </div>
          </div>
          {previewError && <p className="error compact-error">麥克風測試失敗：{previewError}</p>}
        </section>

        <section className="presenter-settings-section">
          <div className="presenter-settings-section-heading"><span><Languages size={17} />課程錄製、字幕與即時口譯語音</span></div>
          <p className="muted">錄製與字幕顯示分開控制；可只錄製供課後重點整理，不顯示即時字幕。所有功能預設關閉。</p>
          <div className="caption-language-row">
            <label>
              講師語言
              <select value={sourceLanguage} onChange={(event) => {
                const next = event.target.value
                if (displayLanguage === sourceLanguage) setDisplayLanguage(next)
                setSourceLanguage(next)
                setInterpretationLanguages(defaultInterpretationLanguages(next))
              }}>
                {SPEAKER_LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>
                    {language.code === 'zh-tw' ? '字正腔圓' : language.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              字幕語言
              <select value={displayLanguage} onChange={(event) => setDisplayLanguage(event.target.value)}>
                {CAPTION_DISPLAY_LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
              </select>
            </label>
            <label>
              字幕大小
              <select value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))}>
                {[32, 36, 42, 48, 56, 64, 72, 80].map((size) => <option key={size} value={size}>{size} px</option>)}
              </select>
            </label>
            <label>
              字幕位置
              <select value={position} onChange={(event) => setPosition(event.target.value as PresenterCaptionSettings['position'])}>
                <option value="top">螢幕上方</option>
                <option value="bottom">螢幕下方</option>
                <option value="center">螢幕置中</option>
              </select>
            </label>
          </div>
          <label className="caption-interpretation-toggle">
            <input checked={fontBold} type="checkbox" onChange={(event) => setFontBold(event.target.checked)} />
            <span>字幕使用粗體</span>
          </label>
          <label className="caption-interpretation-toggle interpretation-audio-toggle">
            <input checked={interpretationAudioEnabled} type="checkbox" onChange={(event) => {
              const enabled = event.target.checked
              if (enabled && !interpretationLanguages.length) setInterpretationLanguages(defaultInterpretationLanguages(sourceLanguage))
              setInterpretationAudioEnabled(enabled)
            }} />
            <span>送出即時口譯語音</span>
          </label>
          {interpretationAudioEnabled && (
            <div className="caption-language-options" aria-label="學生端即時口譯語音語言">
              {availableInterpretationLanguages.map((language) => {
                const checked = interpretationLanguages.includes(language.code)
                return (
                  <label key={language.code}>
                    <input
                      checked={checked}
                      type="checkbox"
                      onChange={(event) => {
                        const next = event.target.checked
                          ? [...new Set([...interpretationLanguages, language.code])]
                          : interpretationLanguages.filter((code) => code !== language.code)
                        setInterpretationLanguages(next)
                      }}
                    />
                    <span>{language.label}{language.code === 'en' && sourceLanguage !== 'en' ? '（預設）' : ''}</span>
                  </label>
                )
              })}
            </div>
          )}
          <p className="muted caption-cost-note">字幕語言與講師語言不同時會建立一條即時翻譯連線。中文授課預設英文口譯，英文授課預設繁體中文；每種口譯語言各建立一條付費即時翻譯連線，學生人數不增加連線數。</p>
        </section>

        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onClose}>取消</button>
          <button disabled={busy || (interpretationAudioEnabled && !interpretationLanguages.length)} type="submit">
            <Settings size={17} />{busy ? '儲存中...' : '儲存設定'}
          </button>
        </div>
      </form>
    </div>
  )
}
