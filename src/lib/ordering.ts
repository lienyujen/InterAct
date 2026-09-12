import { isImageValue } from './sliceImage'

// A scrambled sentence and a list of steps are the same data and want opposite
// layouts. Words belong on one line, read left to right, because that is what
// the finished thing looks like; steps belong stacked, because each one is a
// line of its own. Nobody should have to tell the app which it is — the pieces
// say so themselves.
export function isSentenceOrdering(items: string[]) {
  if (items.length < 3) return false
  if (items.some(isImageValue)) return false
  // Chinese runs about two characters to a word, English rather more letters,
  // so this is generous; anything past it is a clause or a whole step.
  return items.every((item) => item.trim().length > 0 && item.trim().length <= 12)
}

// How a sequence reads when it is shown back: a sentence closes up, a list of
// steps needs an arrow between the items or it looks like one long run-on.
export function joinSequence(items: string[]) {
  return isSentenceOrdering(items) ? items.join('') : items.join(' → ')
}
