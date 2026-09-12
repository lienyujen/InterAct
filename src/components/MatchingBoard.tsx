import { useEffect, useRef, useState } from 'react'
import Sortable from 'sortablejs'

type Props = {
  prompts: string[]
  choices: string[]
  disabled?: boolean
  // The answer for prompts[i], or '' where the slot is still empty.
  onChange: (answer: string[]) => void
}

// Each prompt owns a slot, and the answers live in a bank until they are dragged
// into one. The earlier version put the prompt and the answer in the same
// draggable row, so picking up an answer carried its prompt along with it and
// the pairing could never actually change — you were only ever reordering whole
// pairs. Here the prompts are not in a sortable list at all, so they cannot move.
export function MatchingBoard({ prompts, choices, disabled, onChange }: Props) {
  const signature = JSON.stringify([prompts, choices])
  const [bank, setBank] = useState<string[]>(choices)
  const [slots, setSlots] = useState<string[]>(() => prompts.map(() => ''))
  const bankRef = useRef<HTMLUListElement>(null)
  const slotRefs = useRef<Array<HTMLUListElement | null>>([])
  const latest = useRef({ bank, slots })
  latest.current = { bank, slots }

  useEffect(() => {
    setBank(choices)
    setSlots(prompts.map(() => ''))
  }, [signature])

  useEffect(() => { onChange(slots) }, [slots, onChange])

  useEffect(() => {
    const bankEl = bankRef.current
    if (!bankEl || disabled) return

    // Sortable moves the node; React owns the DOM, so the move is undone and
    // replayed as state. A slot already holding an answer hands its old one back
    // to the bank rather than silently dropping it.
    function place(event: Sortable.SortableEvent) {
      const word = event.item.dataset.word || ''
      const fromSlot = Number(event.from.dataset.slot ?? -1)
      const toSlot = Number(event.to.dataset.slot ?? -1)
      // Put the node back where Sortable found it before touching state. React
      // owns this tree, and leaving the node where Sortable dropped it makes the
      // next render try to remove a child that is no longer there.
      const origin = event.from
      const originIndex = event.oldIndex ?? origin.children.length
      event.item.remove()
      origin.insertBefore(event.item, origin.children[originIndex] || null)

      const nextBank = latest.current.bank.filter((value) => value !== word)
      const nextSlots = [...latest.current.slots]
      if (fromSlot >= 0) nextSlots[fromSlot] = ''
      if (toSlot >= 0) {
        const displaced = nextSlots[toSlot]
        if (displaced && displaced !== word) nextBank.push(displaced)
        nextSlots[toSlot] = word
      } else if (!nextBank.includes(word)) {
        nextBank.push(word)
      }
      setBank(nextBank)
      setSlots(nextSlots)
    }

    const shared: Sortable.Options = {
      group: 'matching-answers',
      animation: 160,
      forceFallback: true,
      fallbackTolerance: 3,
      delay: 150,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: place,
    }
    const instances = [Sortable.create(bankEl, shared)]
    for (const slot of slotRefs.current) {
      if (slot) instances.push(Sortable.create(slot, shared))
    }
    return () => { for (const instance of instances) instance.destroy() }
  }, [disabled, signature])

  return (
    <div className="matching-board">
      <ul className="matching-bank" data-slot={-1} ref={bankRef}>
        {bank.map((word) => <li className="sentence-word" data-word={word} key={word}>{word}</li>)}
      </ul>
      <ol className="matching-rows">
        {prompts.map((prompt, index) => (
          <li key={prompt}>
            <span className="matching-prompt">{prompt}</span>
            <ul
              className={`matching-slot${slots[index] ? ' is-filled' : ''}`}
              data-slot={index}
              ref={(element) => { slotRefs.current[index] = element }}
            >
              {slots[index] && (
                <li className="sentence-word is-placed" data-word={slots[index]}>{slots[index]}</li>
              )}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  )
}
