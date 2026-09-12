import { useEffect, useRef } from 'react'
import Sortable from 'sortablejs'
import { GripVertical } from 'lucide-react'

type Props = {
  // The rows, in their current order. Row i carries values[i].
  values: string[]
  // Drawn to the left of each row and never moves: matching uses it for the
  // prompt the row is answering, ordering leaves it out.
  labels?: string[]
  disabled?: boolean
  onReorder: (values: string[]) => void
}

// Dragging, not tapping. SortableJS rather than HTML5 drag-and-drop, because
// phones do not implement the HTML5 API at all — forceFallback makes it use its
// own pointer implementation everywhere, so a phone, a tablet, a touch display
// and a mouse all behave the same.
export function SortableList({ values, labels, disabled, onReorder }: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  // Read inside the handler rather than captured, so re-creating Sortable on
  // every render is unnecessary.
  const latest = useRef({ values, onReorder })
  latest.current = { values, onReorder }

  useEffect(() => {
    const list = listRef.current
    if (!list || disabled) return
    const sortable = Sortable.create(list, {
      animation: 160,
      forceFallback: true,
      fallbackTolerance: 3,
      // On touch a press has to settle before it counts as a drag, or every
      // attempt to scroll the panel picks a row up instead.
      delay: 150,
      delayOnTouchOnly: true,
      touchStartThreshold: 5,
      ghostClass: 'sortable-ghost',
      chosenClass: 'sortable-chosen',
      dragClass: 'sortable-drag',
      onEnd: (event) => {
        const from = event.oldIndex
        const to = event.newIndex
        if (from == null || to == null || from === to) return
        // Sortable has already moved the node. Put it back and let React render
        // the new order from state instead, so the DOM has exactly one owner.
        const item = event.item
        item.remove()
        list.insertBefore(item, list.children[from] || null)

        const next = [...latest.current.values]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        latest.current.onReorder(next)
      },
    })
    return () => sortable.destroy()
  }, [disabled])

  return (
    <ul className={`sortable-list${disabled ? ' is-disabled' : ''}`} ref={listRef}>
      {values.map((value, index) => (
        <li className="sortable-row" key={value}>
          <span className="sortable-rank">{index + 1}</span>
          {labels && <span className="sortable-label">{labels[index]}</span>}
          <span className="sortable-value">{value}</span>
          {!disabled && <GripVertical className="sortable-grip" size={18} />}
        </li>
      ))}
    </ul>
  )
}
