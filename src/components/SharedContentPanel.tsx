import { Check, ChevronDown, ChevronUp, Clock3, Copy, ExternalLink, Send } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SharedContent } from '../types'

const timeFormatter = new Intl.DateTimeFormat('zh-TW', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

export function SharedContentPanel({ contents }: { contents: SharedContent[] }) {
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)
  const latestContentId = contents[0]?.id

  useEffect(() => {
    setExpanded(false)
  }, [latestContentId])

  if (!contents.length) return null
  const visibleContents = contents.length >= 2 && !expanded ? contents.slice(0, 1) : contents

  async function copyText(content: SharedContent) {
    if (!content.body) return
    await navigator.clipboard.writeText(content.body)
    setCopiedId(content.id)
    window.setTimeout(() => setCopiedId((current) => current === content.id ? null : current), 1600)
  }

  return (
    <section className="shared-content-section" aria-live="polite">
      <div className="shared-content-heading">
        <div><Send size={18} /><h2>講者派送</h2></div>
        {contents.length >= 2 && (
          <button
            aria-expanded={expanded}
            className="ghost-button shared-content-toggle"
            type="button"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}
            {expanded ? '收合舊內容' : `展開全部 ${contents.length} 則`}
          </button>
        )}
      </div>
      <div className="shared-content-list">
        {visibleContents.map((content) => (
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
              <time className="shared-content-time" dateTime={content.created_at} title={new Date(content.created_at).toLocaleString('zh-TW')}>
                <Clock3 size={14} />派送 {timeFormatter.format(new Date(content.created_at))}
              </time>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
