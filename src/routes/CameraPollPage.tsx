import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { CameraPollCaptureModal } from '../components/CameraPollCaptureModal'
import type { DispatchRequest } from '../components/QuestionEditor'
import { cameraPollPresets } from '../lib/cameraPollPresets'
import { getPresenterToken } from '../lib/presenterAuth'
import { requireSupabase } from '../lib/supabase'
import type { CameraPollResult } from '../types'

export function CameraPollPage() {
  const { sessionId = '' } = useParams()
  const [draft, setDraft] = useState<DispatchRequest | null>(() => {
    try { return JSON.parse(localStorage.getItem(`interact:camera-draft:${sessionId}`) || 'null') } catch { return null }
  })
  const [preset, setPreset] = useState('choice')
  const [result, setResult] = useState<CameraPollResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [cameraId, setCameraId] = useState(localStorage.getItem('interact:camera-device') || '')
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([])
  async function refreshCameras() {
    try { setCameras((await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === 'videoinput')) }
    catch { setError('無法取得相機清單，請確認相機權限。') }
  }
  useEffect(() => {
    void refreshCameras()
    navigator.mediaDevices.addEventListener('devicechange', refreshCameras)
    return () => navigator.mediaDevices.removeEventListener('devicechange', refreshCameras)
  }, [])
  useEffect(() => {
    const channel = new BroadcastChannel(`interact:camera-poll:${sessionId}`)
    channel.onmessage = (event) => {
      if (event.data?.type !== 'published') return
      setBusy(false)
      if (event.data.error) setError(event.data.error)
      else void window.interactDesktop?.close()
    }
    return () => channel.close()
  }, [sessionId])

  async function analyze(imageDataUrl: string) {
    if (!draft) return
    if (['imitation', 'custom'].includes(preset) && !draft.promptText.trim()) {
      setError('請先描述要判斷的動作或條件，讓 AI 知道如何統計。')
      return
    }
    setBusy(true)
    setError('')
    try {
      const { data, error: failure } = await requireSupabase().functions.invoke('presenter-action', {
        body: { action: 'analyze_camera_poll', sessionId, presenterToken: getPresenterToken(sessionId), imageDataUrl, options: draft.options, gestureMap: draft.cameraGestureMap, promptText: draft.promptText, cameraMode: preset === 'poster' ? 'poster' : 'gestures' },
      })
      if (failure) {
        const context = (failure as { context?: Response }).context
        const payload = context ? await context.clone().json().catch(() => null) : null
        throw new Error(payload?.message || failure.message)
      }
      if (!data?.result) throw new Error(data?.message || 'AI 未回傳統計，請重試。')
      setResult(data.result)
    } catch (caught) { setError(caught instanceof Error ? caught.message : '分析失敗。') }
    finally { setBusy(false) }
  }

  if (!draft) return <main className="camera-poll-native-page"><p className="error">找不到活動設定，請關閉後重新開啟。</p><button onClick={() => void window.interactDesktop?.close()}>關閉</button></main>
  return <main className="camera-poll-native-page">
    <CameraPollCaptureModal
      open nativeWindow busy={busy} cameraId={cameraId} error={error} posterMode={preset === 'poster'} onCameraReady={() => void refreshCameras()}
      options={draft.options} gestureMap={draft.cameraGestureMap} result={result}
      onAnalyze={(image) => void analyze(image)} onCancel={() => void window.interactDesktop?.close()} onResultChange={setResult}
      onPublish={(approved) => {
        setBusy(true)
        const channel = new BroadcastChannel(`interact:camera-poll:${sessionId}`)
        channel.postMessage({ type: 'publish', request: draft, result: approved })
        channel.close()
      }}
      setup={!result ? <div className="camera-poll-setup">
        <label>Webcam／相機<select value={cameraId} onChange={(event) => {
          setCameraId(event.target.value)
          localStorage.setItem('interact:camera-device', event.target.value)
        }}><option value="">系統預設相機</option>{cameras.map((camera, index) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label || `相機 ${index + 1}`}</option>)}</select>
          <button className="ghost-button" type="button" onClick={() => void refreshCameras()}>重新偵測相機</button>
        </label>
        <label>活動模式<select value={preset} disabled={busy} onChange={(event) => {
          const next = cameraPollPresets.find((item) => item.id === event.target.value)!
          setPreset(next.id)
          setDraft({ ...draft, options: [...next.options], cameraGestureMap: [...next.gestures] })
        }}>{cameraPollPresets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>活動說明／AI 判斷依據<textarea disabled={busy} value={draft.promptText} placeholder="例如：請統計有多少學生完成雙手平舉；或描述要模仿的動作。AI 依可見姿勢判斷，無法確定的列入無法辨識。" onChange={(event) => setDraft({ ...draft, promptText: event.target.value })} /></label>
        {preset === 'poster' && <p className="muted">請用深色筆大字書寫，白紙朝向相機、不要遮擋。拍照後可逐張確認與修改文字；不清楚的文字不會猜填。</p>}
        {preset !== 'poster' && <details><summary>調整選項與姿勢（預設已填好）</summary>{draft.options.map((option, index) => <div className="camera-poll-mapping" key={index}>
          <input aria-label={`選項 ${index + 1}`} value={option} disabled={busy} onChange={(event) => setDraft({ ...draft, options: draft.options.map((value, at) => at === index ? event.target.value : value) })} />
          <input aria-label={`姿勢 ${index + 1}`} value={draft.cameraGestureMap[index]} disabled={busy} onChange={(event) => setDraft({ ...draft, cameraGestureMap: draft.cameraGestureMap.map((value, at) => at === index ? event.target.value : value) })} />
          <button className="ghost-button" disabled={busy || draft.options.length <= 2} onClick={() => setDraft({ ...draft, options: draft.options.filter((_, at) => at !== index), cameraGestureMap: draft.cameraGestureMap.filter((_, at) => at !== index) })}>移除</button>
        </div>)}
        <button className="ghost-button" disabled={busy || draft.options.length >= 8} onClick={() => setDraft({ ...draft, options: [...draft.options, `選項 ${draft.options.length + 1}`], cameraGestureMap: [...draft.cameraGestureMap, ''] })}>新增選項</button>
        </details>}
      </div> : undefined}
    />
  </main>
}
