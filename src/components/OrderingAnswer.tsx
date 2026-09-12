import { useEffect, useState } from 'react'
import { Send } from 'lucide-react'
import { SentenceOrder } from './SentenceOrder'
import { SortableList } from './SortableList'
import { isSentenceOrdering } from '../lib/ordering'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'

type Props = {
  items: string[]
  locale: ParticipantLocale
  busy: boolean
  onSubmit: (ordered: string[]) => void
}

// Everything starts on the list in the order it was dispatched, and the student
// drags it into the order they want. Nothing to place and nothing to count: the
// list as it stands is always a complete answer.
export function OrderingAnswer({ items, locale, busy, onSubmit }: Props) {
  const [order, setOrder] = useState<string[]>(items)
  // Keyed on the contents, not the array. The presenter page hands down a fresh
  // question object every time realtime fires, so depending on the array itself
  // would throw away a half-finished drag each time another student answered.
  const signature = JSON.stringify(items)
  useEffect(() => { setOrder(items) }, [signature])

  // A scrambled sentence gets the sentence layout: the pieces in a bank above and
  // the line being built below, reading across the way it will finally read.
  if (isSentenceOrdering(items)) {
    return (
      <div className="ordering-answer">
        <p className="muted">{participantText(locale, 'dragToSentence')}</p>
        <SentenceOrder disabled={busy} words={items} onChange={setOrder} />
        <div className="ordering-actions">
          <span className="muted">{order.length} / {items.length}</span>
          <button disabled={busy || order.length !== items.length} type="button" onClick={() => onSubmit(order)}>
            <Send size={18} />{participantText(locale, 'submitAnswer')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ordering-answer">
      <p className="muted">{participantText(locale, 'dragToOrder')}</p>
      <SortableList disabled={busy} values={order} onReorder={setOrder} />
      <div className="ordering-actions">
        <button disabled={busy} type="button" onClick={() => onSubmit(order)}>
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

// The same gesture as ordering, which is the whole point of doing it this way:
// the prompts sit still down the left and the student drags the answers up and
// down until each one lines up with the prompt beside it. One list to learn, and
// no dragging between columns, which is the fiddly part on a phone.
export function MatchingAnswer({ prompts, choices, locale, busy, onSubmit }: MatchingProps) {
  const [order, setOrder] = useState<string[]>(choices)
  const signature = JSON.stringify(choices)
  useEffect(() => { setOrder(choices) }, [signature])

  return (
    <div className="matching-answer">
      <p className="muted">{participantText(locale, 'dragToMatch')}</p>
      <SortableList disabled={busy} labels={prompts} values={order} onReorder={setOrder} />
      <div className="ordering-actions">
        <button disabled={busy} type="button" onClick={() => onSubmit(order)}>
          <Send size={18} />{participantText(locale, 'submitAnswer')}
        </button>
      </div>
    </div>
  )
}
