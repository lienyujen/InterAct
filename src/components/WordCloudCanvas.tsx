import cloud from 'd3-cloud'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Message } from '../types'

type CloudWord = {
  text: string
  value: number
  size: number
  x?: number
  y?: number
  rotate?: number
}

const stopWords = new Set([
  '一個', '一些', '一下', '不是', '什麼', '可以', '可能', '因為', '所以', '但是', '如果', '還是', '就是',
  '今天', '現在', '這個', '那個', '這樣', '老師', '同學', '我們', '你們', '他們', '我的', '你的', '他的',
  '的', '了', '是', '在', '有', '我', '你', '他', '她', '也', '都', '很', '和', '與', '嗎', '呢', '啊', '喔',
  'the', 'and', 'that', 'this', 'with', 'from', 'have', 'just', 'very', 'teacher',
])

const palette = ['#68a4ff', '#ffd166', '#ff7f6e', '#55d6a7', '#f4f7ff', '#b7c8ff']

function hashText(text: string) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function seededRandom(seed: number) {
  let value = seed || 1
  return () => {
    value += 0x6d2b79f5
    let result = value
    result = Math.imul(result ^ (result >>> 15), result | 1)
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61)
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296
  }
}

function wordCounts(messages: Message[]) {
  const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'word' })
  const counts = new Map<string, number>()
  for (const message of messages) {
    for (const segment of segmenter.segment(message.content)) {
      if (!segment.isWordLike) continue
      const word = segment.segment.trim().toLocaleLowerCase('zh-TW')
      if (!word || stopWords.has(word) || (/^[a-z\d]$/i.test(word))) continue
      counts.set(word, (counts.get(word) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-TW'))
    .slice(0, 90)
}

export function WordCloudCanvas({ messages }: { messages: Message[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [layoutWords, setLayoutWords] = useState<CloudWord[]>([])
  const counts = useMemo(() => wordCounts(messages), [messages])

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!size.width || !size.height || !counts.length) {
      setLayoutWords([])
      return
    }
    const maximum = counts[0]?.[1] || 1
    const minimum = counts.at(-1)?.[1] || 1
    const seed = counts.reduce((total, [word, count]) => total ^ hashText(`${word}:${count}`), 0)
    const words: CloudWord[] = counts.map(([text, value]) => {
      const ratio = maximum === minimum ? 0.6 : (value - minimum) / (maximum - minimum)
      return { text, value, size: Math.round(20 + Math.sqrt(ratio) * 70) }
    })
    const layout = cloud<CloudWord>()
      .size([size.width, size.height])
      .words(words)
      .padding((word) => word.size > 58 ? 8 : 5)
      .rotate(0)
      .font('Inter, Noto Sans TC, Microsoft JhengHei, sans-serif')
      .fontWeight((word) => word.size > 48 ? 800 : 700)
      .fontSize((word) => word.size)
      .random(seededRandom(seed))
      .spiral('archimedean')
      .on('end', (placed) => setLayoutWords(placed))
    layout.start()
    return () => {
      layout.stop()
    }
  }, [counts, size.height, size.width])

  return (
    <div className="word-cloud-canvas" ref={containerRef}>
      {!messages.length && <p className="word-cloud-empty">等待第一則彈幕...</p>}
      {messages.length > 0 && !counts.length && <p className="word-cloud-empty">正在累積可分析的關鍵詞...</p>}
      {layoutWords.map((word) => (
        <span
          className="word-cloud-word"
          key={word.text}
          style={{
            color: palette[hashText(word.text) % palette.length],
            fontSize: word.size,
            left: '50%',
            top: '50%',
            transform: `translate(${word.x || 0}px, ${word.y || 0}px) translate(-50%, -50%)`,
          }}
          title={`${word.text}：${word.value} 次`}
        >
          {word.text}
        </span>
      ))}
    </div>
  )
}
