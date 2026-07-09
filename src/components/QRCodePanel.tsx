import { QRCodeSVG } from 'qrcode.react'
import { Copy } from 'lucide-react'

type Props = {
  joinUrl: string
  code: string
}

export function QRCodePanel({ joinUrl, code }: Props) {
  return (
    <section className="panel qr-panel">
      <div className="panel-heading">
        <h2>加入場次</h2>
        <span className="code">{code}</span>
      </div>
      <div className="qr-box">
        <QRCodeSVG value={joinUrl} size={176} />
      </div>
      <button className="ghost-button" type="button" onClick={() => navigator.clipboard.writeText(joinUrl)}>
        <Copy size={16} />
        複製加入網址
      </button>
      <p className="join-url">{joinUrl}</p>
    </section>
  )
}
