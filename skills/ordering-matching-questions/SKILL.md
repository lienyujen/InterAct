---
name: ordering-matching-questions
description: Build classroom drag-to-order (排序題) and drag-to-match (配對題) questions generated from a screenshot — the teacher's dispatch options, the AI that writes the items, the student's drag interface on phone/tablet/desktop, server-side marking against a hidden key, and the teacher's live result views including weighted whole-class ranking. Use when implementing ordering or matching question types, adding drag-and-drop answering to a quiz or classroom tool, marking sequence answers without leaking the answer to the client, or showing a class's aggregate ordering.
---

# 排序題與配對題：完整實作規格

這份規格描述 InterAct 的 `ordering` 與 `matching` 兩種題型，涵蓋教師端與學生端的全部行為。
內容來自實際運作的程式碼，所有 prompt、schema 與演算法都是逐字抄錄，不是示意。

實作堆疊是 React 19 + TypeScript + SortableJS + Supabase（Postgres / Realtime / Edge Functions）+ Gemini，
但**規格本身與堆疊無關** —— 換成 Vue + Firebase + GPT 一樣成立。與堆疊綁定的部分會標示出來。

## 這兩種題型在做什麼

兩者都從**截圖派題**出發：老師把螢幕上正在講的東西框起來，AI 讀那張截圖直接出題，學生在自己的手機上拖曳作答。
教材不必事先做成投影片。

- **排序題**：把一組項目排成正確的先後。實驗步驟、歷史事件、程式執行流程、文章結構。
- **配對題**：把右側的答案拖到左側對應的題目上。詞與義、症狀與診斷、公式與適用情境。

## 五種變體

排序題有三種出法乘上「有無標準答案」，配對題只有一種。先把這張表看懂，後面才不會混淆。

| 變體 | 題目來源 | 學生看到 | 批改 |
| --- | --- | --- | --- |
| 排序題 · 項目排序 | AI 從截圖列出 4–8 個有順序的項目 | 直式清單，上下拖曳 | 有標準答案時逐項比對 |
| 排序題 · 語句排序 | 同上，但老師勾選「語句排序」 | 橫式：上方詞塊區、下方句子line | 同上，讀回時字詞相連不加箭頭 |
| 排序題 · 截圖分割 | AI 框出區塊，**前端**切圖上傳 | 直式圖塊清單 | **預設沒有標準答案** |
| 排序題 · 無標準答案 | 以上任一種取消勾選 | 同上 | 不批改，改看全班平均排序 |
| 配對題 | AI 從截圖產生 3–6 組 pair | 上方答案區 + 每題一個空格 | 逐格比對 |

「有標準答案」在項目排序與語句排序**預設開啟**，在截圖分割**預設關閉** ——
切圖排序多半是拿來讓全班討論怎麼排，而不是考他們原圖長怎樣。

## 五條不可妥協的規則

這五條每一條都對應一個實際踩過的坑。照抄就好，不要自己重新推導。

1. **正確答案絕不能出現在題目資料上。** 題目表是全班可讀的，答案放上去等於在 devtools 裡公布答案。
   答案存在另一張只有 service role 讀得到的表，批改在伺服器端做，回給學生的只有對或錯。
   → [references/data-model.md](references/data-model.md)

2. **配對題派送前不准預覽。** 老師按下派送的當下，他的畫面正投在投影幕上。
   先讓他看一眼配對結果，等於先讓全班看到答案。配對題是在派送流程裡才生成的，中間不畫任何東西。
   → [references/ai-generation.md](references/ai-generation.md)

3. **SortableJS 搬動 DOM 節點之後，必須先把節點放回原位再更新 state。**
   React 擁有那棵樹，讓節點留在 Sortable 丟下的位置，下一次 render 會去移除一個已經不在那裡的子節點，
   直接 `removeChild ... not a child of this node` 崩潰。
   → [references/drag-and-drop.md](references/drag-and-drop.md)

4. **配對題的題目欄不可以是可拖曳清單的一部分。** 把題目和答案放在同一個可拖曳的 row 裡，
   拿起答案時題目會跟著走，配對關係永遠不會改變 —— 使用者只是在重排整組配對而已。
   題目固定不動，只有答案會移動。

5. **effect 的相依要用內容的 signature，不能用陣列本身。**
   Realtime 每收到一筆新答案就重新 render 一次、傳下一個新的 question 物件，
   用陣列當相依會在別人作答的瞬間把學生拖到一半的結果清空。

## 建議的實作順序

先讓一題最陽春的排序題從頭到尾跑通，再加變體。跳著做會很難debug。

1. **資料層**：`questions` 的欄位、`question_keys` 分離表、`answers` 的 round 與 unique 限制。
   → [references/data-model.md](references/data-model.md)
2. **學生端拖曳**：`SortableList`，先用寫死的項目測。手機、平板、觸控螢幕、滑鼠都要試。
   → [references/drag-and-drop.md](references/drag-and-drop.md)
3. **送出與批改**：走伺服器端 endpoint，不要讓瀏覽器直接寫入答案表。
4. **教師端結果**：先做有標準答案的版本（正確順序 + 每人作答 + 對錯）。
   → [references/teacher-results.md](references/teacher-results.md)
5. **AI 出題**：接上截圖生成。
   → [references/ai-generation.md](references/ai-generation.md)
6. **變體**：語句排序 → 無標準答案（含平均排序結果與動畫）→ 截圖分割 → 配對題。

## 教師端派送對話框

從截圖派題的對話框裡，選了排序題或配對題之後出現的選項：

**兩種題型共用**

- `同時把截圖給學生看`（checkbox，**預設關閉**）→ 寫入 `share_screenshot`。
  預設關閉的理由：切圖排序的原圖就是答案。其他題型（圖上點選、派送畫面）預設開啟。
- `題目（選填）` / `出題方向（選填）` → 傳給 AI 當作 `presenter_direction`。
  配對題的提示文字要明說這是唯一的操控機會，因為它不會預覽：
  `例如：找出 5 個難的中文詞和英文詞做成配對題`

**排序題專屬**

- `用截圖分割出題`（checkbox）→ 切換兩套完全不同的 UI。
  勾選時同步把「有標準答案」設為 false（`onChange` 裡一起做掉）。
- 勾了分割：`有標準答案` checkbox（預設關）＋ `切成 [3|4|5|6] 塊`
- 沒勾分割：`AI 產生題目` 按鈕 → 產出項目清單 → 才出現 `有標準答案`（預設開）與 `語句排序`（預設關）兩個 checkbox
  ＋ 可用上下箭頭調整順序的清單。**清單顯示的是正確順序，派送時才打散。**

**派送時計算出來的值**

```ts
const dispatchOptions = type === 'ordering' ? shuffled(items) : finalOptions
onCreate({
  type,
  options: dispatchOptions,
  promptText: promptText.trim(),
  key: questionKey(),
  sliceCount: type === 'ordering' && sliceImage ? sliceCount : null,
  sliceHasAnswer: orderingHasAnswer,
  // 分割出的題目沒有「語句」可言，所以互斥
  sentenceMode: type === 'ordering' && !sliceImage && sentenceMode,
  shareScreenshot,
})

function questionKey(): QuestionKey {
  if (type === 'ordering') {
    return { choices: [], correctValues: orderingHasAnswer ? items : [] }
  }
  // 配對題在派送流程裡才生成，這裡一定是空的
  return { choices: [], correctValues: [] }
}
```

打散用 Fisher–Yates，不要用 `sort(() => Math.random() - 0.5)`（分布不均）：

```ts
function shuffled<T>(list: T[]) {
  const copy = [...list]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[target]] = [copy[target], copy[index]]
  }
  return copy
}
```

**送出按鈕的停用條件**：排序題在非分割模式下，項目少於 2 個不給送。

## 學生端

學生端依 `question.type` 與 `question.sentence_mode` 分成三個元件，全部共用同一套 SortableJS 設定。
完整程式碼在 [references/drag-and-drop.md](references/drag-and-drop.md)。

| 條件 | 元件 | 版面 | 完成判定 |
| --- | --- | --- | --- |
| `ordering` 且 `!sentence_mode` | `SortableList` | 直式，出場即為完整答案 | 永遠可送出 |
| `ordering` 且 `sentence_mode` | `SentenceOrder` | 橫式，詞塊區在上、句子line在下 | 全部詞塊都放進句子line |
| `matching` | `MatchingBoard` | 答案區在上、每題一格 | 每一格都有答案 |

一般排序題沒有「還沒排完」的狀態 —— 項目一開始就全在清單上，當下的順序永遠是一個完整答案，
所以不需要計數，按鈕永遠可按。另外兩種要顯示 `n / total` 並在未完成時停用送出。

送出之後不再顯示拖曳介面，改顯示結果字串：

```tsx
{answer && ['ordering', 'matching'].includes(question.type) && (
  <p className={answer.is_correct === false ? 'error' : 'success'}>
    {answer.is_correct === true ? '答對了！'
      : answer.is_correct === false ? '答錯了，等老師公布正確答案。'
      : '答案已送出。'}
  </p>
)}
```

`is_correct === null`（無標準答案）要走第三種文案，不能落到「答錯了」。

**學生端文案**（繁中／英文雙語）

| key | zh-TW | en |
| --- | --- | --- |
| `dragToOrder` | 拖曳項目排出你認為的順序 | Drag the items into order |
| `dragToSentence` | 把上面的詞塊拖到下面排好 | Drag the pieces below into order |
| `dragToMatch` | 拖曳右邊的答案，對齊左邊的題目 | Drag each answer next to the prompt it matches |
| `submitAnswer` | 送出答案 | Submit answer |
| `answerCorrect` | 答對了！ | Correct! |
| `answerWrong` | 答錯了，等老師公布正確答案。 | Not quite — wait for the answer. |
| `answerSent` | 答案已送出。 | Answer sent. |

## 教師端結果面板

依「有沒有標準答案」分成兩條完全不同的路。判定用的是**答案本身是否存在**，不是題目上的旗標：

```ts
const key = orderingKey || []          // 另外抓回來的，不在 question 上
const keyKnown = orderingKey !== null  // null = 還在載入
const marked = key.length > 0
```

`keyKnown` 這個中間狀態很重要：答案還沒抓回來的那幾百毫秒，面板要**什麼都不說**。
對一題其實有答案的題目顯示「這一題沒有標準答案」，比空白難看得多。

**有標準答案**：正確率長條 → 正確順序／正確配對 → 最常見的錯誤順序 → 每位學生的作答與對錯。

**無標準答案**：排序題顯示**平均排序結果**（依平均名次排序，附同意度標籤，收到新答案即時重排並帶動畫）；
配對題顯示每題的選擇分布。

兩者都在下方提供一個收合的按鈕 `改為有標準答案` / `修改正確順序`，
展開後是拖曳編輯器。**不要在無標準答案的題目上直接攤開一個送出答案的表單** ——
老師派送時已經說了這題沒有答案，面板不應該當場打他臉。設定答案之後，已經收到的作答會全部重新批改。

演算法與版面細節在 [references/teacher-results.md](references/teacher-results.md)。

## 再做一次

兩種題型都支援同一題開第二輪。`questions.answer_round` 加一，答案帶著自己那一輪的編號，
結果面板只看當前輪：

```ts
const roundAnswers = answers.filter((entry) => entry.round === question.answer_round)
```

`answers` 上的 `unique (question_id, participant_id, round)` 讓同一輪只能交一次，
但新的一輪可以再交。兩輪之間的比較（幾人改了答案、改對幾人）是額外的面板。

## 名詞

寫使用者看得到的文字時照這張表，不要自己另外發明：

| 用這個 | 不要用 | 為什麼 |
| --- | --- | --- |
| 語句排序 | 重組句子 | 「重組」帶著把打散的東西修好的意味，這裡是排序 |
| 平均排序結果 | 全班排出來的順序 | 那不是全班排出來的，是每個人的名次平均出來的 |
| 意見分歧 | 低同意度 | 課堂上要能直接念出來 |
