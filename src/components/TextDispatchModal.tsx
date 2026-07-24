import { Link, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'

type Props = {
  busy: boolean
  error: string
  open: boolean
  onCancel: () => void
  onSend: (body: string, url: string) => void
}

export function TextDispatchModal({ busy, error, open, onCancel, onSend }: Props) {
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    if (!open) {
      setBody('')
      setUrl('')
    }
  }, [open])

  if (!open) return null

  function submit(event: FormEvent) {
    event.preventDefault()
    if (body.trim() || url.trim()) onSend(body.trim(), url.trim())
  }

  return (
    <div className="modal-backdrop text-dispatch-backdrop" role="presentation">
      <form className="modal text-dispatch-modal" onSubmit={submit}>
        <div className="modal-heading">
          <div>
            <h2>文字派送</h2>
            <p className="muted">內容會即時出現在學員裝置上</p>
          </div>
          <button className="ghost-button icon-button" aria-label="關閉文字派送" title="關閉" type="button" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>
        <label>
          文字
          <textarea
            maxLength={5000}
            placeholder="輸入可讓學員複製的文字"
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <label>
          <span className="field-label-with-icon"><Link size={16} />網址</span>
          <input
            inputMode="url"
            maxLength={2048}
            placeholder="https://example.com"
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>取消</button>
          <button disabled={busy || (!body.trim() && !url.trim())} type="submit">
            <Send size={17} />{busy ? '派送中...' : '立即派送'}
          </button>
        </div>
      </form>
    </div>
  )
}
