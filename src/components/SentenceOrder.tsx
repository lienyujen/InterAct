import { useEffect, useRef, useState } from 'react'
import Sortable from 'sortablejs'

type Props = {
  words: string[]
  disabled?: boolean
  // Called with the sentence as it currently stands, so the parent can submit it.
  onChange: (answer: string[]) => void
}

// A scrambled sentence, laid out the way the finished sentence will read. The
// shuffled pieces sit in a bank at the top and the student drags them down into
// the line below; dragging one back out takes it off the line again. Two lists
// sharing a group, so a word can be moved between them or reordered within the
// line with the same gesture.
export function SentenceOrder({ words, disabled, onChange }: Props) {
  const signature = JSON.stringify(words)
  const [pool, setPool] = useState<string[]>(words)
  const [answer, setAnswer] = useState<string[]>([])
  const poolRef = useRef<HTMLUListElement>(null)
  const answerRef = useRef<HTMLUListElement>(null)
  // Read by the handlers so Sortable never has to be rebuilt mid-drag.
  const latest = useRef({ pool, answer })
  latest.current = { pool, answer }

  useEffect(() => {
    setPool(words)
    setAnswer([])
  }, [signature])

  useEffect(() => { onChange(answer) }, [answer, onChange])

  useEffect(() => {
    const bank: HTMLUListElement | null = poolRef.current
    const line: HTMLUListElement | null = answerRef.current
    if (!bank || !line || disabled) return

    // Sortable moves the nodes; React owns the DOM, so every drop is undone and
    // replayed as state instead. Rebuilding both lists from one snapshot keeps
    // the two in step however the word travelled.
    function apply(event: Sortable.SortableEvent) {
      const fromLine = event.from === line
      const toLine = event.to === line
      const from = event.oldIndex
      const to = event.newIndex
      if (from == null || to == null) return
      event.item.remove()
      const back = (fromLine ? line : bank) as HTMLUListElement
      back.insertBefore(event.item, back.children[from] || null)

      const nextPool = [...latest.current.pool]
      const nextAnswer = [...latest.current.answer]
      const source = fromLine ? nextAnswer : nextPool
      const target = toLine ? nextAnswer : nextPool
      const [moved] = source.splice(from, 1)
      if (moved === undefined) return
      target.splice(to, 0, moved)
      setPool(nextPool)
      setAnswer(nextAnswer)
    }

    const options: Sortable.Options = {
      group: 'sentence-words',
      animation: 160,
      forceFallback: true,
      fallbackTolerance: 3,
      delay: 150,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: apply,
    }
    const a = Sortable.create(bank, options)
    const b = Sortable.create(line, options)
    return () => { a.destroy(); b.destroy() }
  }, [disabled, signature])

  return (
    <div className="sentence-order">
      <ul className={`sentence-bank${pool.length ? '' : ' is-empty'}`} ref={poolRef}>
        {pool.map((word) => <li className="sentence-word" key={word}>{word}</li>)}
      </ul>
      <ul className={`sentence-line${answer.length ? '' : ' is-empty'}`} ref={answerRef}>
        {answer.map((word) => <li className="sentence-word is-placed" key={word}>{word}</li>)}
      </ul>
    </div>
  )
}
