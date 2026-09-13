# 拖曳：SortableJS 與 React 共處

這是整套功能最容易做壞的地方。三個元件共用同一組設定與同一條規則，先把規則看懂再看程式碼。

## 為什麼是 SortableJS 而不是 HTML5 drag-and-drop

**手機完全沒有實作 HTML5 的 drag-and-drop API。** 桌機瀏覽器測起來完美的東西，在學生手上一動也不動。

SortableJS 加上 `forceFallback: true` 會改用它自己的指標實作，
手機、平板、觸控顯示器與滑鼠因此走完全相同的程式路徑 —— 一種行為，一個地方可以debug。

## 共用設定

三個元件逐字共用這組設定，不要各自微調：

```ts
const options: Sortable.Options = {
  animation: 160,
  // 手機沒有 HTML5 DnD。強制走 fallback，讓所有裝置行為一致。
  forceFallback: true,
  fallbackTolerance: 3,
  // 觸控上，按壓必須先穩定下來才算拖曳，
  // 否則每一次想捲動面板都會變成把一列抓起來。
  delay: 150,
  delayOnTouchOnly: true,
  touchStartThreshold: 5,
  ghostClass: 'sortable-ghost',
  chosenClass: 'sortable-chosen',
  dragClass: 'sortable-drag',
  onEnd: handler,
}
```

`delay: 150` 搭配 `delayOnTouchOnly: true` 是靠實機調出來的。再短，捲動會變成誤拖；再長，拖曳會感覺遲鈍。
滑鼠不受這個延遲影響。

## 規則：先把節點放回去，再更新 state

SortableJS 直接操作 DOM。React 認為那棵樹是它的。兩者都對自己有信心，所以必須有一個明確的擁有者。

做法是：**讓 Sortable 的搬動完全不生效**，把它當成一個純粹的手勢事件，
在 `onEnd` 裡先把節點搬回原位，再把這個手勢當成 state 變更重播一次，由 React 重新 render 出新順序。

```ts
onEnd: (event) => {
  const from = event.oldIndex
  const to = event.newIndex
  if (from == null || to == null || from === to) return

  // Sortable 已經把節點移走了。放回去，讓 React 從 state 重新 render 新順序，
  // 這樣 DOM 就只有一個擁有者。
  const item = event.item
  item.remove()
  list.insertBefore(item, list.children[from] || null)

  const next = [...latest.current.values]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  latest.current.onReorder(next)
}
```

漏掉這段的症狀是 `NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.` ——
而且不是每次都發生，取決於拖去哪裡，所以很容易被誤判成偶發問題。

## 規則：用 ref 讀當下的值，effect 相依用 signature

兩個相關但不同的陷阱：

**一、handler 讀 ref，不要讀閉包。** 把 `values` 直接寫進 `onEnd` 的閉包，
就必須在每次 render 後重建 Sortable 實例，拖到一半重建會讓那次拖曳直接斷掉。

```ts
// 在 handler 裡讀，不要被閉包捕捉，這樣就不必每次 render 都重建 Sortable
const latest = useRef({ values, onReorder })
latest.current = { values, onReorder }
```

**二、effect 的相依用內容的 signature。**

```ts
// 依內容，不是依陣列。教師頁面每次 realtime 觸發都會傳下一個全新的 question 物件，
// 直接依賴陣列本身會在別人作答的瞬間丟掉學生拖到一半的結果。
const signature = JSON.stringify(items)
useEffect(() => { setOrder(items) }, [signature])
```

這個 bug 在一個人測試時完全看不出來 —— 要有第二個人同時作答才會發生。

---

## 元件一：SortableList（一般排序題）

出場即為完整答案：所有項目一開始就在清單上，當下的順序永遠可以送出。
`labels` 是給教師端答案編輯器用的（左側固定不動的標籤），學生端不傳。

```tsx
import { useEffect, useRef } from 'react'
import Sortable from 'sortablejs'
import { GripVertical } from 'lucide-react'
import { isImageValue } from '../lib/sliceImage'

type Props = {
  // 各列的當下順序。第 i 列裝的是 values[i]。
  values: string[]
  // 畫在每一列左邊、永遠不動
  labels?: string[]
  disabled?: boolean
  onReorder: (values: string[]) => void
}

export function SortableList({ values, labels, disabled, onReorder }: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  const latest = useRef({ values, onReorder })
  latest.current = { values, onReorder }

  useEffect(() => {
    const list = listRef.current
    if (!list || disabled) return
    const sortable = Sortable.create(list, {
      animation: 160,
      forceFallback: true,
      fallbackTolerance: 3,
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
          {isImageValue(value)
            ? <img alt={`第 ${index + 1} 塊`} className="sortable-image" src={value} />
            : <span className="sortable-value">{value}</span>}
          {!disabled && <GripVertical className="sortable-grip" size={18} />}
        </li>
      ))}
    </ul>
  )
}
```

`key={value}` 用值本身而非索引：索引當 key 會讓 React 重用錯誤的節點，動畫因此亂跳。
這也代表**項目必須互不重複**。

## 元件二：SentenceOrder（語句排序）

橫式版面，因為完成的句子是橫著讀的。打散的詞塊放在上方的詞塊區，學生把它們拖到下方的句子line；
從句子line拖回去就是取消。兩個清單共用同一個 `group`，所以同一個手勢既可以在兩區之間搬移，也可以在句子line內重排。

```tsx
export function SentenceOrder({ words, disabled, onChange }: Props) {
  const signature = JSON.stringify(words)
  const [pool, setPool] = useState<string[]>(words)
  const [answer, setAnswer] = useState<string[]>([])
  const poolRef = useRef<HTMLUListElement>(null)
  const answerRef = useRef<HTMLUListElement>(null)
  const latest = useRef({ pool, answer })
  latest.current = { pool, answer }

  useEffect(() => { setPool(words); setAnswer([]) }, [signature])
  useEffect(() => { onChange(answer) }, [answer, onChange])

  useEffect(() => {
    const bank: HTMLUListElement | null = poolRef.current
    const line: HTMLUListElement | null = answerRef.current
    if (!bank || !line || disabled) return

    // Sortable 搬動節點；React 擁有 DOM，所以每一次放下都要先還原再以 state 重播。
    // 兩個清單從同一份快照一起重建，不論詞塊怎麼移動都保持同步。
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

    const options: Sortable.Options = { group: 'sentence-words', /* ...共用設定... */ onEnd: apply }
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
```

關鍵在 `apply` 裡從**同一份快照**重建兩個陣列。分開處理來源與目標會讓兩區在跨區拖曳時失去同步。

## 元件三：MatchingBoard（配對題）

**題目不在任何可拖曳清單裡。** 這是整個元件存在的理由。

早期版本把題目與答案放在同一個可拖曳的 row，結果拿起答案時題目跟著走 ——
配對關係永遠不會改變，使用者只是在重排整組配對。完全錯誤，而且看起來很像有在動，很難察覺。

正確結構：答案放在上方的答案區，每個題目下方有一個空格，答案區與所有空格共用同一個 `group`。

```tsx
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

    function place(event: Sortable.SortableEvent) {
      const word = event.item.dataset.word || ''
      const fromSlot = Number(event.from.dataset.slot ?? -1)
      const toSlot = Number(event.to.dataset.slot ?? -1)

      // 先把節點放回 Sortable 找到它的地方，再動 state
      const origin = event.from
      const originIndex = event.oldIndex ?? origin.children.length
      event.item.remove()
      origin.insertBefore(event.item, origin.children[originIndex] || null)

      const nextBank = latest.current.bank.filter((value) => value !== word)
      const nextSlots = [...latest.current.slots]
      if (fromSlot >= 0) nextSlots[fromSlot] = ''
      if (toSlot >= 0) {
        // 已經有答案的格子把舊的還回答案區，而不是默默丟掉
        const displaced = nextSlots[toSlot]
        if (displaced && displaced !== word) nextBank.push(displaced)
        nextSlots[toSlot] = word
      } else if (!nextBank.includes(word)) {
        nextBank.push(word)
      }
      setBank(nextBank)
      setSlots(nextSlots)
    }

    const shared: Sortable.Options = { group: 'matching-answers', /* ...共用設定... */ onEnd: place }
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
```

三個細節：

- **`data-slot`** 讓 handler 知道拖去了哪裡。答案區是 `-1`，每個空格是自己的索引。
- **`data-word`** 讓 handler 知道拖的是哪個答案，不必從 DOM 文字反推。
- **被擠掉的答案要回到答案區。** 往一個已經有答案的格子放東西，舊的必須回到答案區。
  默默丟掉會讓學生的一個答案憑空消失，而且他不會知道發生了什麼事。

`slots` 是一個與 `prompts` 等長、空格處為 `''` 的陣列。這就是直接送得出去的答案格式。

## CSS

只列會影響行為的部分，配色照自己的設計系統。

```css
/* Sortable 會把這三個 class 加到節點上 */
.sortable-ghost  { background: var(--surface-subtle); opacity: 0.5; }
.sortable-chosen { border-color: var(--primary); }
.sortable-drag   { box-shadow: 0 10px 26px rgb(24 34 58 / 28%); cursor: grabbing; opacity: 1; }

.sortable-row { cursor: grab; display: flex; align-items: center; }

/* 虛線，讓空的句子line讀起來像「東西放這裡」，而不是一個載入失敗的方框 */
.sentence-line { border: 1px dashed var(--border-strong); border-radius: var(--radius-lg); }
.sentence-bank { background: var(--surface-subtle); border-radius: var(--radius-lg); }
.sentence-bank, .sentence-line { display: flex; flex-wrap: wrap; gap: 8px; min-height: 54px; }

.sentence-word { border-radius: 999px; cursor: grab; padding: 7px 14px; }
.sentence-word.is-placed { background: color-mix(in srgb, var(--primary) 12%, var(--surface)); }

.matching-slot { border: 1px dashed var(--border-strong); border-radius: 999px; min-height: 42px; display: flex; }
.matching-slot.is-filled { border-style: solid; border-color: transparent; }
```

`min-height` 是必要的：空的落點區域如果沒有高度，就沒有東西可以拖進去。

觸控裝置的觸控目標要加大。用 `@media (any-pointer: coarse)`，不要用螢幕寬度 ——
教室裡的觸控顯示器是一個很大的粗指標裝置，用寬度判斷會漏掉它。
**這條規則在開發機上永遠不會生效**，所以看起來永遠是對的；要在實機上驗。

## 驗收清單

每一項都在真實裝置上做一次。用 `dispatchEvent` 合成事件測不出來 ——
合成的 click 不會觸發 `:active`，也不會走 SortableJS 的指標路徑。

- [ ] 手機：拖曳可以重排；**在清單上滑動可以捲頁**，不會誤抓
- [ ] 平板：同上
- [ ] 觸控顯示器：同上，且觸控目標夠大
- [ ] 滑鼠：拖曳沒有 150ms 延遲
- [ ] 另一個人同時作答：自己拖到一半的結果不會被清掉
- [ ] 配對題：把答案 A 拖進已經放了答案 B 的格子，B 要回到答案區
- [ ] 配對題：從格子把答案拖回答案區，格子要變回空的
- [ ] 語句排序：把所有詞塊拖進句子line再全部拖回來，詞塊區要回到完整狀態
- [ ] 整個過程 console 沒有 `removeChild` 錯誤
