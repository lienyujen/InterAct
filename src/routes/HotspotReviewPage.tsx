import { useCallback, useEffect, useState } from 'react'
import { MousePointerClick, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { HotspotImage } from '../components/HotspotImage'
import { getPresenterToken } from '../lib/presenterAuth'
import { parsePins, pinLabel } from '../lib/hotspot'
import { requireSupabase } from '../lib/supabase'

type HotspotResult = {
  question: { id: string; title: string; prompt_text: string | null; max_pins: number | null; answer_round: number }
  answers: Array<{ participant_name: string; answer_values: string[] | null; round: number }>
  imageUrl: string | null
}

// The panel on the presenter page is a column beside the class list, and a
// classroom photo in it is thumbnail-sized. This is the same picture at the size
// the taps were actually made on.
export function HotspotReviewPage() {
  const { sessionId = '', questionId = '' } = useParams()
  const [result, setResult] = useState<HotspotResult | null>(null)
  const [anonymous, setAnonymous] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setError('找不到講者權限，請關閉視窗後重新開啟。')
      return
    }
    const { data, error: loadError } = await requireSupabase().functions.invoke('presenter-action', {
      body: { action: 'get_hotspot_result', sessionId, presenterToken, questionId },
    })
    if (loadError || !data?.question) {
      setError(data?.message || '無法載入這一題。')
      return
    }
    setResult(data as HotspotResult)
    setError('')
  }, [questionId, sessionId])

  useEffect(() => {
    void load()
    // Students keep tapping while the window is open; the picture should keep up.
    const timer = window.setInterval(() => void load(), 2500)
    return () => window.clearInterval(timer)
  }, [load])

  const current = result?.answers.filter((entry) => entry.round === result.question.answer_round) || []
  const pins = current.flatMap((entry, index) => parsePins(entry.answer_values).map((point) => ({
    ...point,
    label: pinLabel(entry.participant_name, anonymous, index),
  })))

  return (
    <main className="hotspot-review-window">
      <header>
        <div>
          <p className="eyebrow"><MousePointerClick size={17} />圖上點選檢視</p>
          <h1>{result?.question.prompt_text || result?.question.title || '圖上點選'}</h1>
        </div>
        <label className="show-answers-toggle">
          <input checked={anonymous} type="checkbox" onChange={(event) => setAnonymous(event.target.checked)} />
          匿名顯示
        </label>
        <button aria-label="關閉檢視視窗" className="icon-button" title="關閉" type="button" onClick={() => window.interactDesktop?.close()}>
          <X size={24} />
        </button>
      </header>
      {error && <p className="error">{error}</p>}
      {result && (
        <>
          <p className="muted">
            已作答 {current.length} 人 · 共 {pins.length} 個標記
            {result.question.max_pins && result.question.max_pins > 1 ? `（每人最多 ${result.question.max_pins} 個）` : ''}
            {result.question.answer_round > 1 ? ` · 第 ${result.question.answer_round} 輪` : ''}
          </p>
          {result.imageUrl
            ? <div className="hotspot-review-stage"><HotspotImage alt="學生點選結果" imageUrl={result.imageUrl} pins={pins} /></div>
            : <p className="muted">找不到這一題的截圖。</p>}
        </>
      )}
      {!result && !error && <p className="muted">正在載入截圖與作答...</p>}
    </main>
  )
}
