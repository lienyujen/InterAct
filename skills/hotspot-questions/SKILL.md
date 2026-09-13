---
name: hotspot-questions
description: Build a classroom hotspot question (熱點標記題 / 圖上點選) where students tap locations on a shared image and the teacher sees every tap from the whole class overlaid back on the original picture. Covers the fractional coordinate system, pin rendering and removal, per-student tap limits, the enlarged review window, and why this question type is deliberately never auto-marked. Use when implementing tap-on-image answering, overlaying many users' coordinates on one image, or building a "where is it" question for a quiz or classroom tool.
---

# 熱點標記題：完整實作規格

InterAct 裡叫「圖上點選」。老師派出一張截圖，學生在圖上直接點，老師端把**全班的點疊回原圖**。
每人可點 1 到 5 次。

內容來自實際運作的程式碼，所有座標處理、CSS 與端點都是逐字抄錄。
實作是 React 19 + TypeScript + Supabase，但只有 Realtime 與 RLS 那幾段與堆疊有關。

## 這一題在做什麼，以及它為什麼不批改

「錯了幾個」只告訴你成績，「錯在哪裡」才告訴你要補什麼。
十八個學生點在同一個錯誤位置，那個位置就是下一段要講的內容。

所以這一題**刻意不自動批改**。沒有正確答案、沒有 AI、沒有隱藏的答案表 ——
`answers.is_correct` 永遠是 `null`，而且是被資料庫政策強制的。
老師要的讀數不是「幾個人錯」，而是「他們全都跑到哪裡去了」。

這和排序題／配對題是**完全相反的架構**，兩者放在一起看最清楚：

| | 排序題 · 配對題 | 熱點標記題 |
| --- | --- | --- |
| 答案 | 存在只有伺服器讀得到的表 | 沒有答案 |
| 送出路徑 | 伺服器端 endpoint（批改要讀答案） | 瀏覽器直接寫入，RLS 把關 |
| `is_correct` | true / false / null | 永遠 null（政策強制） |
| AI | 出題 | 完全沒有 |
| 老師看什麼 | 對錯與分布 | 一張疊了全班標記的圖 |

因為沒有祕密，學生的瀏覽器可以直接 insert，不需要繞伺服器。**不要為了一致性把它也搬到伺服器端** ——
那是在為一個不存在的問題付延遲。

## 四條規則

1. **座標存分數，絕不存像素。** 全班在手機上作答，老師在投影機上看。
   在其中一邊記下來的像素在另一邊毫無意義。存 0–1 之間的比例。

2. **標記要半透明。** 十八個人點同一個地方就是那個發現本身；不透明的標記會把它顯示成一個點。

3. **按下標記的視覺回饋必須「疊加」在定位之上，不能「取代」它。**
   全域的 `button:active { transform: translateY(1px) }` 在 specificity 上贏過 `.hotspot-pin`，
   會把定位用的 transform 整個換掉 —— 標記從手指底下滑走，放開時落在圖片上，
   handler 永遠收不到 click，學生的標記取消不掉。
   → [references/pin-rendering.md](references/pin-rendering.md)

4. **點滿了就是滿了，不要默默丟掉最舊的那一個。**
   標記是畫在它所標示的位置**上方**的，所以學生想點自己的標記時，手指其實落在圖片上。
   默默替換掉最舊的一個，在他看來就是「我的第一個標記跳到我剛剛點的地方」。

## 資料模型

沒有新表。只在 `questions` 上多一個欄位，答案用既有的 `answer_values`。

```sql
-- questions
type text not null check (type in (..., 'hotspot', ...)),
-- 一個學生可以在圖上放幾個點；其他題型為 null
max_pins integer null check (max_pins is null or max_pins between 1 and 10),
-- 是否把出題的截圖給學生看。以圖為主的題型預設 true。
share_screenshot boolean not null default true,
answer_round integer not null default 1,
```

```sql
-- answers（與其他題型共用）
answer_values text[] null,   -- ["0.4312,0.2871", "0.5108,0.6640"]
is_correct boolean null,     -- 永遠 null
round integer not null default 1,
unique (question_id, participant_id, round)
```

一個標記序列化成 `"x,y"` 字串，四位小數。用 `text[]` 而不是 jsonb，
是為了和所有其他題型共用同一個欄位 —— 匯出、統計、再做一次全部不必分岔。

```ts
export function parsePins(values: string[] | null | undefined) {
  return (values || []).flatMap((value) => {
    const [x, y] = value.split(',').map(Number)
    return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : []
  })
}

export function serialisePins(points: Array<{ x: number; y: number }>) {
  return points.map((point) => `${point.x.toFixed(4)},${point.y.toFixed(4)}`)
}
```

`parsePins` 用 `flatMap` 把壞掉的值丟掉而不是產生 `NaN`。
一個 `NaN` 座標會讓標記飛到畫面外，而且沒有任何錯誤訊息。

四位小數在 4K 寬度上大約是半個像素，夠精確，而且比浮點數原樣短很多。

## 資料庫政策：強制不批改

學生的瀏覽器直接寫入 `answers`，所以規則全部寫在 insert 政策上。

```sql
create policy "answer active questions" on public.answers for insert
to anon, authenticated
with check (
  exists (select 1 from public.sessions
          where sessions.id = answers.session_id and sessions.status = 'active')
  and exists (
    select 1 from public.questions
    where questions.id = answers.question_id
      and questions.session_id = answers.session_id
      and questions.status = 'active'
      and questions.type <> 'custom_quiz'
      and questions.answer_round = answers.round
      -- 校園 wifi 來回的三秒寬限。沒有它，29.8 秒按下的學生會在 30.2 秒被拒絕，
      -- 答案憑空消失，老師看到的是一個 bug 而不是一個截止時間。
      -- 這件事從不公告：寬限是默默救回一個趕在截止前送出的答案，
      -- 而不是對外宣稱多給了時間。
      and (questions.answer_seconds is null
           or questions.started_at is null
           or now() <= questions.started_at + make_interval(secs => questions.answer_seconds + 3))
  )
  and exists (select 1 from public.participants
              where participants.id = answers.participant_id
                and participants.session_id = answers.session_id
                and participants.name = answers.participant_name)
  -- 客戶端不准自己宣稱對錯
  and is_correct is null
  and coalesce(array_length(answer_values, 1), 0) <= 20
  and not exists (
    select 1 from unnest(coalesce(answer_values, '{}'::text[])) as submitted_value
    where char_length(submitted_value) > 500
  )
);
```

`and is_correct is null` 那一行就是「熱點題永不批改」的執行點。它同時也擋住其他題型的客戶端偽造。

**注意：政策不檢查 `max_pins`。** 上限是 UI 層的約束，不是安全邊界 ——
多點幾個點沒有任何好處，不值得為它寫一條政策。`<= 20` 那條擋住的是惡意的大量灌入。

## 教師端：派送

派送對話框裡熱點題只有一個專屬選項：

```tsx
{type === 'hotspot' && (
  <div className="question-timing">
    <TimingRow
      formatValue={(value) => `${value} 次`}
      label="每人可點"
      offLabel="1 次"
      presets={[1, 2, 3, 5]}
      value={maxPins}
      onChange={(value) => setMaxPins(value ?? 1)}
    />
  </div>
)}
```

派送時 `maxPins: type === 'hotspot' ? maxPins : null`。

`share_screenshot` 對熱點題維持預設的 `true` —— 沒有圖就沒有題目。
（排序題與配對題相反，它們預設不送圖。）

**沒有 AI 出題步驟。** 題目就是老師打的那一句話加上那張截圖。
沒有東西需要生成，因為沒有正確答案。

## 學生端

```tsx
{question.type === 'hotspot' && imageUrl && (
  <div className="participant-hotspot">
    <HotspotImage
      alt={participantText(locale, 'imageAlt')}
      imageUrl={imageUrl}
      pins={(answer ? parsePins(answer.answer_values) : pins).map((pin, index) => ({
        ...pin, label: String(index + 1), own: true,
      }))}
      onPlace={!answer && acceptingAnswers
        ? (point) => setPins((current) => (
          // 滿了就是滿了。默默丟掉最舊的來騰位子，在學生眼裡是
          // 「我的第一個標記跳到我剛剛點的地方」—— 因為標記畫在它所標示的位置上方，
          // 所以想點自己標記的學生，手指其實落在圖片上，
          // 於是失去一個他本來想留著的標記。
          current.length >= (question.max_pins || 1) ? current : [...current, point]
        ))
        : undefined}
      onRemove={!answer && acceptingAnswers
        ? (index) => setPins((current) => current.filter((_, at) => at !== index))
        : undefined}
    />
    {!answer && acceptingAnswers && (
      <div className="participant-hotspot-actions">
        {/* 顯示還剩幾次，不是已經用了幾次：學生在決定要不要再花一次，
            「剩 1 次」回答了這個問題，「2 / 3」沒有。 */}
        <span className="muted">
          {pins.length < (question.max_pins || 1)
            ? participantText(locale, 'pinsLeft').replace('{n}', String((question.max_pins || 1) - pins.length))
            : participantText(locale, 'pinsUsed')}
        </span>
        <button disabled={!pins.length} type="button" onClick={() => onSubmit(serialisePins(pins))}>
          <Send size={18} />{participantText(locale, 'submitAnswer')}
        </button>
      </div>
    )}
  </div>
)}
```

三個細節：

- **`own: true`** 讓學生自己的標記用不同顏色（紅），和老師端看到的全班標記（藍）區分開。
- **送出後不再顯示動作列**，但圖和標記留著 —— 學生要能看見自己點了哪裡。
- **剩餘次數，不是已用次數。** 學生在決定要不要再花一次。

**圖片不要畫兩次。** 學生端頁面有一段共用的「顯示派送截圖」，熱點題必須排除，
因為 `HotspotImage` 自己就會畫那張圖：

```tsx
{screenshot && question?.share_screenshot
  && question?.type !== 'file_upload' && question?.type !== 'hotspot' && (
  <img alt={...} className="participant-image" src={screenshot.public_url} />
)}
```

**雙語文案**

| key | zh-TW | en |
| --- | --- | --- |
| `pinsLeft` | 還可以點 {n} 次 | {n} left |
| `pinsUsed` | 已經點滿了，點自己的標記可以取消 | All used — tap one of yours to take it back |
| `answerSent` | 答案已送出。 | Answer sent. |

`pinsUsed` 的文案順便教了怎麼取消 —— 這是唯一會讓學生知道標記可以點掉的地方。

## 教師端：結果

一張圖，疊上全班的每一個標記。詳見 [references/teacher-review.md](references/teacher-review.md)。

```ts
const current = answers.filter((entry) => entry.round === question.answer_round)
const pins = current.flatMap((entry, index) => parsePins(entry.answer_values).map((point) => ({
  ...point,
  label: pinLabel(entry.participant_name, anonymousEnabled, index),
})))
```

摘要行要分開講人數與標記數，因為每人可以點很多次：

```
已作答 12 人 · 共 31 個標記（每人最多 3 個）
```

標記上的字是學生名字的第一個字；匿名模式改成序號，否則匿名設定形同虛設：

```ts
export function pinLabel(name: string, anonymous: boolean, index: number) {
  if (anonymous) return String(index + 1)
  const first = [...name.trim()][0]
  return first ? first.toUpperCase() : String(index + 1)
}
```

`[...name]` 用展開運算子而不是 `name[0]`，這樣才能正確取出 emoji 與 surrogate pair 的第一個字元。

## 放大檢視

老師端的面板是班級清單旁邊的一欄，裡面的圖是縮圖大小 —— 而這一題的整個結果就是那張圖。
所以一定要有放大。桌面版開真正的視窗，網頁版開全螢幕覆蓋層：

```ts
function enlarge() {
  if (window.interactDesktop) {
    void window.interactDesktop.openHotspotReview(question.session_id, question.id)
    return
  }
  setExpanded(true)
}
```

放大視窗每 2.5 秒重新抓一次 —— 視窗開著的時候學生還在點，圖要跟得上。
→ [references/teacher-review.md](references/teacher-review.md)

## 再做一次

`answer_round` 加一，答案帶著自己那一輪的編號，面板只畫當前輪的標記。
這一題的第二輪特別有價值：先讓全班點、看見大家點在哪裡、討論、再點一次，
兩張圖並排就是那段討論有沒有效的證據。

## 驗收清單

在真實裝置上做。**合成的 click 事件測不出第 3 條規則** ——
`dispatchEvent(new MouseEvent('click'))` 不會觸發 `:active`，
所以那個 bug 在自動化測試裡永遠是綠的。

- [ ] 手機：點圖片會放下標記，落點就在手指的位置
- [ ] 手機：**用手指點自己的標記，標記會消失**（這條最容易壞）
- [ ] 點滿之後再點圖片：沒有反應，既有的標記一個都不動
- [ ] 送出後標記還在，動作列消失
- [ ] 老師端：全班的標記疊在同一張圖上，重疊處看得出顏色更深
- [ ] 老師端：放大檢視打得開，而且學生繼續點時會自己更新
- [ ] 匿名模式：標記上的字變成數字
- [ ] 手機直式與橫式、不同螢幕尺寸：標記相對於圖片內容的位置不變
