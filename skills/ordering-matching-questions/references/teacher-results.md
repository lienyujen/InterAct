# 教師端結果面板

老師在講台上看的東西。所有計算都在前端從 `answers` 算出來，即時重算，不打伺服器。

## 面板骨架

```tsx
if (question.type === 'ordering' || question.type === 'matching') {
  const roundAnswers = answers.filter((entry) => entry.round === question.answer_round)
  const key = props.orderingKey || []
  const keyKnown = props.orderingKey !== null
  const marked = key.length > 0
  const correct = roundAnswers.filter((entry) => entry.is_correct === true).length
  const rate = roundAnswers.length ? Math.round((correct / roundAnswers.length) * 100) : 0
```

**三態很重要：**

- `orderingKey === null` — 還在載入，什麼都不要說
- `orderingKey === []` — 確定沒有標準答案
- `orderingKey.length > 0` — 有答案

摘要行：

```tsx
<p className="muted">
  已作答 {roundAnswers.length} 人{question.answer_round > 1 ? `（第 ${question.answer_round} 輪）` : ''}
  {/* 答案載入前保持沉默：對一題其實有答案的題目顯示「沒有標準答案」，
      即使只有抓取的那一瞬間，也比什麼都不說更糟。 */}
  {!keyKnown ? '' : marked ? ` · 答對 ${correct} 人（${rate}%）` : ' · 這一題沒有標準答案'}
</p>
```

面板的組成：

| 區塊 | 有標準答案 | 無標準答案 |
| --- | --- | --- |
| 正確率長條 | ✓ | — |
| 正確順序 / 正確配對 | ✓ | — |
| 最常見的錯誤順序 | ✓ 排序題 | — |
| 平均排序結果 | — | ✓ 排序題 |
| 各題選擇分布 | ✓ 配對題 | ✓ 配對題 |
| 答案編輯器（收合） | ✓ 修改 | ✓ 改為有標準答案 |
| 學生的作答 | ✓ 排序題（附對錯） | ✓ 排序題 |

## 平均排序結果（無標準答案的排序題）

這是整個功能最有教學價值的一塊。**不要給老師一張表叫他自己看出結論。**
每個項目用「它被排在第幾位」的平均分數來排，清單就是那個分數的順序。

```ts
function OrderingSpread({ items, answers }: { items: string[]; answers: Answer[] }) {
  const ranked = items
    .map((item) => {
      const places = answers
        .map((entry) => (entry.answer_values || []).indexOf(item))
        .filter((place) => place >= 0)
      const mean = places.length
        ? places.reduce((sum, place) => sum + place + 1, 0) / places.length
        : items.length + 1          // 沒人排到的沉到最後
      return { item, mean, places }
    })
    .sort((a, b) => a.mean - b.mean)
    .map((entry, index) => {
      // 同意度：把它排在「全班最後landing的那個位置」的人佔多少。
      // 高代表全班有共識；低代表它在那裡只是因為分歧互相抵消掉了。
      const agreed = entry.places.filter((place) => place === index).length
      return {
        ...entry,
        agreement: entry.places.length ? Math.round((agreed / entry.places.length) * 100) : 0,
      }
    })
```

同意度是在排序**之後**才算的，這點很關鍵：它衡量的是「這個項目落在這個位置的紮實程度」，
不是任何單獨項目的離散程度。

標籤用老師可以直接念出來的話，不要顯示平均值：

```tsx
{/* 這個排法有多紮實，用老師可以念出來的話講。平均名次決定了順序，
    但不值得念出來；而且只有一筆答案時，每一項都是自動全班一致。 */}
{answers.length > 1 && (
  <span
    className={`ordering-agreement is-${entry.agreement === 100 ? 'firm' : entry.agreement >= 60 ? 'most' : 'split'}`}
    title={`${entry.places.length} 人中有 ${Math.round(entry.agreement * entry.places.length / 100)} 人排在第 ${index + 1}`}
  >
    {entry.agreement === 100 ? '全班一致' : entry.agreement >= 60 ? '多數這樣排' : '意見分歧'}
  </span>
)}
```

`answers.length > 1` 的守衛不能省：只有一個人作答時每一項都是 100%，
顯示「全班一致」會很荒謬。

老師要的結論是「哪幾項有共識、哪幾項意見分歧」，分歧的那一項就是接下來值得討論的。

## 重排動畫（FLIP）

每收到一筆答案，順序就可能改變。一個在兩眼之間默默重排的清單讀起來像故障 ——
看到列「走過去」才會讀成是全班在移動它。

用 Web Animations API 做 FLIP：先量舊位置，讓 React 排好版，再從舊位置動畫到新位置。

```ts
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

// 用法：相依是順序的字串化，不是答案陣列
useRankAnimation(listRef, ranked.map((entry) => entry.item).join())
```

必須是 `useLayoutEffect` 而不是 `useEffect` —— 要在瀏覽器畫出新版面**之前**量測並掛上動畫，
否則會先看到跳一下再看到動畫。

每一列要有 `data-rank-key`，值用項目本身，這樣跨 render 才追得到同一列。

## 最常見的錯誤順序（有標準答案的排序題）

不是列出全班產生過的每一種順序 —— 六個項目有 720 種 —— 而是列出**不只一個人**排出來的那幾種，
共同的誤解才會在那裡顯現。

```ts
function OrderingMistakes({ answers, correctValues, sentenceMode }) {
  const wrong = new Map<string, number>()
  for (const entry of answers) {
    const given = entry.answer_values || []
    if (given.length === correctValues.length && correctValues.every((v, i) => v === given[i])) continue
    const key = joinSequence(given, sentenceMode)
    if (key) wrong.set(key, (wrong.get(key) || 0) + 1)
  }
  const shared = [...wrong.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  // 圖塊沒有可讀的單行形式，而且每一份作答下面都列出來了
  if (correctValues.some(isImageValue)) return null
  if (!shared.length) return null
  ...
}
```

## 一個序列怎麼讀回來

一句重組完的句子要收攏，因為它本來就是一句話；一個排名要保留箭頭，
否則選項會黏成一行無意義的字。

```ts
export function joinSequence(items: string[], sentenceMode: boolean) {
  return sentenceMode ? items.join('') : items.join(' → ')
}
```

**這不是從碎片猜出來的。** 四個短意見和四句話的四個詞從這裡看起來完全一樣 ——
老師在派送時就說了這是哪一種，它跟著題目以 `sentence_mode` 傳過來。

早期版本用長度猜（短的就是詞、長的就是選項），錯得很離譜也很難debug。不要猜，讓老師說。

三種讀回形式：

```tsx
function SequenceReadout({ values, sentenceMode }) {
  // 從截圖切出來的圖塊：老師要看到的是那些碎片，不是它們碰巧存在哪個路徑
  if (values.some(isImageValue)) {
    return <ol className="ordering-tiles">{values.map((v, i) => <li key={v}><img alt={`第 ${i + 1} 塊`} src={v} /></li>)}</ol>
  }
  if (sentenceMode) {
    return <ul className="sentence-readout">{values.map((v) => <li key={v}>{v}</li>)}</ul>
  }
  return <ol className="ordering-consensus is-key">{values.map((v) => <li key={v}>{v}</li>)}</ol>
}
```

## 配對題的各題分布

每一題一條，顯示正確率、正解，以及**最常被誤選的那一個** —— 那才是要講的東西。

```ts
function MatchingBreakdown({ prompts, answers, correctValues }) {
  return (
    <ul className="matching-breakdown">
      {prompts.map((prompt, index) => {
        const picks = answers.map((entry) => (entry.answer_values || [])[index]).filter(Boolean)
        const right = correctValues[index]
        const correct = picks.filter((pick) => pick === right).length
        const rate = picks.length ? Math.round((correct / picks.length) * 100) : 0
        const wrong = new Map<string, number>()
        for (const pick of picks) if (pick !== right) wrong.set(pick, (wrong.get(pick) || 0) + 1)
        const [worst] = [...wrong.entries()].sort((a, b) => b[1] - a[1])
        return (
          <li key={prompt}>
            <div className="matching-breakdown-head">
              <span className="matching-prompt">{prompt}</span>
              <b className={rate >= 60 ? 'is-good' : 'is-weak'}>{rate}%</b>
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${rate}%` }} /></div>
            <p className="muted">
              正解：{right || '尚未設定'} · 答對 {correct} / {picks.length} 人
              {worst ? ` · 最常誤選「${worst[0]}」${worst[1]} 人` : ''}
            </p>
          </li>
        )
      })}
    </ul>
  )
}
```

`correctValues` 傳空陣列時同一個元件也能用在無標準答案的配對題上，
此時 `right` 是 undefined，顯示 `正解：尚未設定`，分布本身仍然有意義。

## 學生的作答

老師在講解答案時會照著念的東西。有標準答案時帶對錯判定，沒有時就只顯示他們排了什麼。

```tsx
<h3 className="ordering-subheading">學生的作答</h3>
<ul className="ordering-submissions">
  {answers.map((entry, index) => (
    <li key={entry.id}>
      <div className="ordering-submission-head">
        <strong>{anonymousEnabled ? `匿名作答 ${index + 1}` : entry.participant_name}</strong>
        {marked && (
          <span className={entry.is_correct ? 'file-verdict is-correct' : 'file-verdict is-wrong'}>
            {entry.is_correct ? '答對' : '答錯'}
          </span>
        )}
      </div>
      <SequenceReadout sentenceMode={sentenceMode} values={entry.answer_values || []} />
    </li>
  ))}
</ul>
```

匿名模式要一併處理：開啟時顯示 `匿名作答 1、2、3`，連匯出的報表也要匿名。

## 答案編輯器

兩種題型都可以事後設定或修改答案，設定後已收到的作答會全部重新批改。

**預設是收合的一顆按鈕，不是攤開的表單。** 老師派送時已經說了這題沒有答案，
面板直接給他一個「送出答案」的表單等於當場打他臉。

```tsx
if (!open) {
  return (
    <div className="ordering-key-set">
      <button className="ghost-button" disabled={busy} type="button"
        onClick={() => { setOrder(current.length ? current : items); setOpen(true) }}>
        {current.length ? '修改正確順序' : '改為有標準答案'}
      </button>
    </div>
  )
}
```

展開後排序題用 `SortableList`、配對題用 `MatchingBoard` —— 與學生端同一個元件，
所以老師設定答案的手勢和學生作答的手勢一模一樣。

**一定要留「改為無標準答案」這條退路：**

```tsx
{current.length > 0 && (
  // 回到開放式的題目。一次設錯否則會讓全班永遠掛著答錯，沒有辦法回頭。
  <button className="ghost-button" disabled={busy || saving} type="button" onClick={() => void save([])}>
    改為無標準答案
  </button>
)}
```

配對題的送出按鈕要等每一格都填滿（`picked.length === prompts.length && picked.every(Boolean)`），
並顯示 `n / total` 的進度。排序題不需要，清單本身永遠是完整的。
