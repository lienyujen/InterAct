import { QRCodeSVG } from 'qrcode.react'
import { Minus, QrCode, X } from 'lucide-react'
import type { HTMLAttributes } from 'react'

type Props = {
  joinUrl: string
  onClose?: () => void
  onMinimize?: () => void
  qrInteractionProps?: Pick<HTMLAttributes<HTMLDivElement>, 'onPointerCancel' | 'onPointerDown' | 'onPointerUp'>
}

export function QRCodePanel({ joinUrl, onClose, onMinimize, qrInteractionProps }: Props) {
  return (
    <section className="panel qr-panel">
      <div className="panel-heading">
        <h2>
          <span className="heading-icon"><QrCode size={16} /></span>加入場次
        </h2>
        {(onMinimize || onClose) && (
          <div
            className="qr-window-actions"
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
          >
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
      <div className="qr-box" {...qrInteractionProps}>
        <QRCodeSVG marginSize={2} value={joinUrl} size={172} />
      </div>
      <p className="join-url" title={joinUrl}>{joinUrl}</p>
    </section>
  )
}
