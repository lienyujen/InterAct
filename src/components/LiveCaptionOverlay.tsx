type Props = {
  fontBold?: boolean
  fontSize?: number
  position?: 'top' | 'center' | 'bottom'
  text: string
  status?: 'idle' | 'starting' | 'live' | 'error'
}

export function LiveCaptionOverlay({ fontBold = false, fontSize = 36, position = 'bottom', text, status = 'live' }: Props) {
  const [displayText, setDisplayText] = useState(text)

  useEffect(() => {
    if (!text) {
      setDisplayText('')
      return
    }
    const timer = window.setTimeout(() => setDisplayText(text), 100)
    return () => window.clearTimeout(timer)
  }, [text])

  if (!displayText && status !== 'starting') return null
  const visibleText = latestCaptionLines(displayText, fontSize)
  return (
    <div className={`live-caption-overlay caption-position-${position}`} aria-live="polite">
      <p style={{ fontSize: `${fontSize}px`, fontWeight: fontBold ? 800 : 400 }}>{visibleText || '正在連接麥克風...'}</p>
    </div>
  )
}
import { useEffect, useState } from 'react'
import { latestCaptionLines } from '../lib/captionDisplay'
