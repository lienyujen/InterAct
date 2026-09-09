import { useState } from 'react'
import { Send } from 'lucide-react'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'

type Props = {
  items: string[]
  locale: ParticipantLocale
  busy: boolean
  onSubmit: (ordered: string[]) => void
}

// Tap to place, not drag to reorder. HTML5 drag does not work on a phone at all,
// and a pointer-event reimplementation is fiddly to hit with a thumb while
// thirty people race. Tapping assigns the next position; tapping again takes it
// back, so a mistake costs one tap rather than a careful drag.
export function OrderingAnswer({ items, locale, busy, onSubmit }: Props) {
  const [order, setOrder] = useState<string[]>([])

  function toggle(item: string) {
    setOrder((current) => current.includes(item)
      ? current.filter((value) => value !== item)
      : [...current, item])
  }

  const complete = order.length === items.length

  return (
    <div className="ordering-answer">
      <ul className="ordering-list">
        {items.map((item) => {
          const position = order.indexOf(item)
          return (
            <li key={item}>
              <button
                className={`ordering-option${position >= 0 ? ' is-placed' : ''}`}
                disabled={busy}
                type="button"
                onClick={() => toggle(item)}
              >
                <span className="ordering-rank">{position >= 0 ? position + 1 : ''}</span>
                <span>{item}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="ordering-actions">
        <span className="muted">{order.length} / {items.length}</span>
        <button disabled={busy || !complete} type="button" onClick={() => onSubmit(order)}>
          <Send size={18} />{participantText(locale, 'submitAnswer')}
        </button>
      </div>
    </div>
  )
}

type MatchingProps = {
  prompts: string[]
  choices: string[]
  locale: ParticipantLocale
  busy: boolean
  onSubmit: (chosen: string[]) => void
}

// A select per row rather than dragging lines between two columns: the same
// reasoning, and a native select is the one control a phone always gets right.
export function MatchingAnswer({ prompts, choices, locale, busy, onSubmit }: MatchingProps) {
  const [picked, setPicked] = useState<string[]>(() => prompts.map(() => ''))
  const complete = picked.every(Boolean)

  // Every choice belongs to exactly one prompt, so taking one that is already
  // used swaps the two rather than leaving the same answer in two places. A
  // student who reconsiders one row should not have to notice they have now
  // answered another row twice.
  function choose(index: number, value: string) {
    setPicked((current) => {
      const held = value ? current.indexOf(value) : -1
      return current.map((entry, at) => {
        if (at === index) return value
        if (at === held) return current[index]
        return entry
      })
    })
  }

  return (
    <div className="matching-answer">
      <ul className="matching-list">
        {prompts.map((prompt, index) => (
          <li key={prompt}>
            <span className="matching-prompt">{prompt}</span>
            <select
              aria-label={prompt}
              disabled={busy}
              value={picked[index]}
              onChange={(event) => choose(index, event.target.value)}
            >
              <option value="">—</option>
              {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <div className="ordering-actions">
        <span className="muted">{picked.filter(Boolean).length} / {prompts.length}</span>
        <button disabled={busy || !complete} type="button" onClick={() => onSubmit(picked)}>
          <Send size={18} />{participantText(locale, 'submitAnswer')}
        </button>
      </div>
    </div>
  )
}
