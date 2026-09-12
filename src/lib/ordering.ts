// How a sequence reads when it is shown back. A rebuilt sentence closes up,
// because that is what it is; a ranking keeps an arrow between the items or the
// options run together into one nonsense line.
//
// This is not guessed from the pieces. Four short opinions and four words of a
// sentence look exactly alike from here — the presenter says which it is when
// they dispatch, and it travels on the question as sentence_mode.
export function joinSequence(items: string[], sentenceMode: boolean) {
  return sentenceMode ? items.join('') : items.join(' → ')
}
