import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'
import { isImageValue } from '../lib/sliceImage'
import { joinSequence } from '../lib/ordering'
import type { Answer } from '../types'

// The read-only half of a 排序題 result, lifted out of QuestionResult so the
// presenter's panel and the enlarged window show the same thing rather than
// two implementations that drift. A sliced ordering hands back pieces of a
// screenshot, and a piece rendered a few hundred pixels wide in the results
// column is the reason the window has to exist at all.

export function OrderingMistakes({ answers, correctValues, sentenceMode }: { answers: Answer[]; correctValues: string[]; sentenceMode: boolean }) {
  const wrong = new Map<string, number>()
  for (const entry of answers) {
    const given = entry.answer_values || []
    if (given.length === correctValues.length && correctValues.every((value, index) => value === given[index])) continue
    const key = joinSequence(given, sentenceMode)
    if (key) wrong.set(key, (wrong.get(key) || 0) + 1)
  }
  const shared = [...wrong.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  // Image tiles have no readable one-line form, and every answer is listed below.
  if (correctValues.some(isImageValue)) return null
  if (!shared.length) return null
  return (
    <>
      <h3 className="ordering-subheading">最常見的錯誤順序</h3>
      <ul className="ordering-mistakes">
        {shared.map(([sequence, count]) => (
          <li key={sequence}><span>{sequence}</span><b>{count} 人</b></li>
        ))}
      </ul>
    </>
  )
}

// The unmarked case the presenter asked for: every item against every position,
// so a class that agrees on the first two steps and splits on the rest reads as
// exactly that.
// Slide rows to their new places instead of teleporting. The class's order
// changes every time an answer lands, and a list that silently rearranges
// between glances reads as a glitch — seeing a row travel is what makes it read
// as the class moving it. Measure where rows were, let React lay them out, then
// animate from the old position to the new one.
function useRankAnimation(listRef: RefObject<HTMLOListElement | null>, order: string) {
  const previous = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const next = new Map<string, number>()
    for (const row of [...list.children] as HTMLElement[]) {
      const key = row.dataset.rankKey
      if (!key) continue
      const top = row.offsetTop
      next.set(key, top)
      const before = previous.current.get(key)
      if (before === undefined || before === top) continue
      row.animate(
        [{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }],
        { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      )
    }
    previous.current = next
  }, [listRef, order])
}

// A sequence read back across the line instead of down a list, so a sentence
// looks like the sentence it is meant to become.
export function SequenceReadout({ values, sentenceMode }: { values: string[]; sentenceMode: boolean }) {
  // Tiles cut out of a screenshot: the presenter needs to see the pieces, not
  // the storage paths they happen to live at.
  if (values.some(isImageValue)) {
    return (
      <ol className="ordering-tiles">
        {values.map((value, index) => (
          <li key={value}><img alt={`第 ${index + 1} 塊`} src={value} /></li>
        ))}
      </ol>
    )
  }
  if (sentenceMode) {
    return <ul className="sentence-readout">{values.map((value) => <li key={value}>{value}</li>)}</ul>
  }
  return <ol className="ordering-consensus is-key">{values.map((value) => <li key={value}>{value}</li>)}</ol>
}

// What each student actually sent, which is the thing a teacher reads out loud
// when going over the answer. Marked questions carry a verdict; an open one just
// shows what they arranged.
export function OrderingSubmissions({ answers, anonymousEnabled, marked, sentenceMode }: {
  answers: Answer[]
  anonymousEnabled: boolean
  marked: boolean
  sentenceMode: boolean
}) {
  if (!answers.length) return null
  return (
    <>
      <h3 className="ordering-subheading">學生的作答</h3>
      <ul className="ordering-submissions">
        {answers.map((entry, index) => {
          const values = entry.answer_values || []
          return (
            <li key={entry.id}>
              <div className="ordering-submission-head">
                <strong>{anonymousEnabled ? `匿名作答 ${index + 1}` : entry.participant_name}</strong>
                {marked && (
                  <span className={entry.is_correct ? 'file-verdict is-correct' : 'file-verdict is-wrong'}>
                    {entry.is_correct ? '答對' : '答錯'}
                  </span>
                )}
              </div>
              <SequenceReadout sentenceMode={sentenceMode} values={values} />
            </li>
          )
        })}
      </ul>
    </>
  )
}

export function OrderingSpread({ items, answers }: { items: string[]; answers: Answer[] }) {
  // The class's answer, worked out by weight rather than shown as a table for
  // the presenter to work out themselves: each item is scored by the average
  // place it was given, and the list is that score in order. 同意度 is the share
  // who put it exactly where the class landed — high means the class agreed,
  // low means the item is where it is only because the disagreement cancelled out.
  const ranked = items
    .map((item) => {
      const places = answers
        .map((entry) => (entry.answer_values || []).indexOf(item))
        .filter((place) => place >= 0)
      const mean = places.length
        ? places.reduce((sum, place) => sum + place + 1, 0) / places.length
        : items.length + 1
      return { item, mean, places }
    })
    .sort((a, b) => a.mean - b.mean)
    .map((entry, index) => {
      const agreed = entry.places.filter((place) => place === index).length
      return {
        ...entry,
        agreement: entry.places.length ? Math.round((agreed / entry.places.length) * 100) : 0,
      }
    })

  const listRef = useRef<HTMLOListElement>(null)
  useRankAnimation(listRef, ranked.map((entry) => entry.item).join())

  return (
    <>
      <h3 className="ordering-subheading">平均排序結果</h3>
      <ol className="ordering-ranked" ref={listRef}>
        {ranked.map((entry, index) => (
          <li data-rank-key={entry.item} key={entry.item}>
            {isImageValue(entry.item)
              ? <img alt={`第 ${index + 1} 個區塊`} className="ordering-ranked-image" src={entry.item} />
              : <span className="ordering-ranked-item">{entry.item}</span>}
            {/* How solid this placing is, in words a teacher can read out. The
                average rank decided the order but is not worth saying aloud, and
                with one answer in, every item is trivially unanimous. */}
            {answers.length > 1 && (
              <span
                className={`ordering-agreement is-${entry.agreement === 100 ? 'firm' : entry.agreement >= 60 ? 'most' : 'split'}`}
                title={`${entry.places.length} 人中有 ${Math.round(entry.agreement * entry.places.length / 100)} 人排在第 ${index + 1}`}
              >
                {entry.agreement === 100 ? '全班一致' : entry.agreement >= 60 ? '多數這樣排' : '意見分歧'}
              </span>
            )}
          </li>
        ))}
      </ol>
    </>
  )
}
