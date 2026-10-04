import { Camera, RefreshCw, Send, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CameraPollResult } from '../types'

type Props = {
  busy: boolean
  cameraId: string
  error: string
  gestureMap: string[]
  open: boolean
  options: string[]
  result: CameraPollResult | null
  onAnalyze: (imageDataUrl: string) => void
  onCancel: () => void
  onPublish: (result: CameraPollResult) => void
  onResultChange: (result: CameraPollResult | null) => void
}

export function CameraPollCaptureModal({ busy, cameraId, error, gestureMap, open, options, result, onAnalyze, onCancel, onPublish, onResultChange }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [countdown, setCountdown] = useState<number | null>(null)

  useEffect(() => {
    if (!open || result) return
    let cancelled = false
    setPreviewError('')
    void navigator.mediaDevices.getUserMedia({ video: { ...(cameraId ? { deviceId: { exact: cameraId } } : {}), width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((stream) => {
        if (cancelled) return stream.getTracks().forEach((track) => track.stop())
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play()
        }
      })
      .catch((reason: unknown) => setPreviewError(reason instanceof Error ? reason.message : '無法開啟相機。'))
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [cameraId, open, result])

  async function capture() {
    if (!videoRef.current || busy) return
    for (const value of [3, 2, 1]) {
      setCountdown(value)
      await new Promise((resolve) => window.setTimeout(resolve, 700))
    }
    setCountdown(null)
    const video = videoRef.current
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    onAnalyze(canvas.toDataURL('image/jpeg', 0.82))
  }

  if (!open) return null
  return (
    <div className="modal-backdrop camera-poll-backdrop">
      <section className="modal camera-poll-modal" aria-modal="true" role="dialog">
        <div className="modal-heading">
          <div><h2><Camera size={21} />全班相機作答</h2><p className="muted">只送出這一幀給 AI 分析；不儲存照片、不做人臉辨識。</p></div>
          <button className="ghost-button icon-button" aria-label="關閉" type="button" onClick={onCancel}><X size={18} /></button>
        </div>
        {!result ? (
          <div className="camera-poll-preview-wrap">
            <video className="camera-poll-preview" muted playsInline ref={videoRef} />
            {countdown !== null && <strong className="camera-poll-countdown">{countdown}</strong>}
            {previewError && <p className="error">相機預覽失敗：{previewError}</p>}
            <div className="camera-poll-legend">{options.map((option, index) => <span key={index}><b>{option}</b>＝{gestureMap[index]}</span>)}</div>
            <button disabled={busy || Boolean(previewError) || countdown !== null} type="button" onClick={() => void capture()}><Camera size={18} />{busy ? 'AI 分析中…' : '倒數拍照並分析'}</button>
          </div>
        ) : (
          <div className="camera-poll-review">
            <h3>請確認統計，再派送給全班</h3>
            {options.map((option, index) => (
              <label key={index}><span><b>{option}</b> · {gestureMap[index]}</span><input min={0} type="number" value={result.counts[index] || 0} onChange={(event) => {
                const counts = [...result.counts]
                counts[index] = Math.max(0, Number(event.target.value) || 0)
                onResultChange({ ...result, counts, totalDetected: counts.reduce((sum, count) => sum + count, 0) + result.unknownCount })
              }} /></label>
            ))}
            <label><span>無法辨識／未作答</span><input min={0} type="number" value={result.unknownCount} onChange={(event) => {
              const unknownCount = Math.max(0, Number(event.target.value) || 0)
              onResultChange({ ...result, unknownCount, totalDetected: result.counts.reduce((sum, count) => sum + count, 0) + unknownCount })
            }} /></label>
            <p className="muted">共辨識 {result.totalDetected} 人 · AI 信心 {Math.round(result.confidence * 100)}%{result.notes ? ` · ${result.notes}` : ''}</p>
            <div className="modal-actions">
              <button className="ghost-button" disabled={busy} type="button" onClick={() => onResultChange(null)}><RefreshCw size={17} />重拍</button>
              <button disabled={busy} type="button" onClick={() => onPublish(result)}><Send size={17} />發布統計</button>
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </section>
    </div>
  )
}
