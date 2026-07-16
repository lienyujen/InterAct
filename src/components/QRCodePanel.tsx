import { QRCodeSVG } from 'qrcode.react'
import { Minus, X } from 'lucide-react'

type Props = {
  joinUrl: string
  onClose?: () => void
  onMinimize?: () => void
}

export function QRCodePanel({ joinUrl, onClose, onMinimize }: Props) {
  return (
    <section className="panel qr-panel">
      <div className="panel-heading">
        <h2>加入場次</h2>
        {(onMinimize || onClose) && (
          <div className="qr-window-actions" onDoubleClick={(event) => event.stopPropagation()}>
            {onMinimize && (
              <button aria-label="最小化" title="最小化" type="button" onClick={onMinimize}>
                <Minus size={18} />
              </button>
            )}
            {onClose && (
              <button aria-label="關閉" title="關閉" type="button" onClick={onClose}>
                <X size={18} />
              </button>
            )}
          </div>
        )}
      </div>
      <div className="qr-box">
        <QRCodeSVG value={joinUrl} size={176} />
      </div>
      <p className="join-url" title={joinUrl}>{joinUrl}</p>
    </section>
  )
}
