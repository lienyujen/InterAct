import { Check, Copy, ExternalLink, Send } from 'lucide-react'
import { useState } from 'react'
import type { SharedContent } from '../types'

export function SharedContentPanel({ contents }: { contents: SharedContent[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  if (!contents.length) return null

  async function copyText(content: SharedContent) {
    if (!content.body) return
    await navigator.clipboard.writeText(content.body)
    setCopiedId(content.id)
    window.setTimeout(() => setCopiedId((current) => current === content.id ? null : current), 1600)
  }

  return (
    <section className="shared-content-section" aria-live="polite">
      <div className="shared-content-heading"><Send size={18} /><h2>講者派送</h2></div>
      <div className="shared-content-list">
        {contents.map((content) => (
          <article className="shared-content-item" key={content.id}>
            {content.body && <p>{content.body}</p>}
            <div className="shared-content-actions">
              {content.body && (
                <button className="ghost-button" type="button" onClick={() => copyText(content)}>
                  {copiedId === content.id ? <Check size={17} /> : <Copy size={17} />}
                  {copiedId === content.id ? '已複製' : '複製文字'}
                </button>
              )}
              {content.url && (
                <a className="primary-link" href={content.url} rel="noopener noreferrer" target="_blank">
                  <ExternalLink size={17} />開啟網址
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
