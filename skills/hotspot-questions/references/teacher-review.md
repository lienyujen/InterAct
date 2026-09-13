# 教師端結果與放大檢視

這一題的結果**就是那張圖**。沒有長條圖、沒有正確率、沒有排行 ——
把全班的每一個標記疊回他們當時看的那張圖上，讀數自己會浮出來。

## 結果面板

```tsx
function HotspotResults(props: Props & { question: Question }) {
  const { anonymousEnabled, answers, question, screenshotUrl } = props
  const [expanded, setExpanded] = useState(false)

  // 全班點過的每一下，回到他們當時看的那張圖上。老師要的讀數不是幾個人錯，
  // 而是他們全都跑到哪裡去了 —— 十八個標記擠在同一個地方，
  // 那就是接下來要解釋的東西。
  const current = answers.filter((entry) => entry.round === question.answer_round)
  const pins = current.flatMap((entry, index) => parsePins(entry.answer_values).map((point) => ({
    ...point,
    label: pinLabel(entry.participant_name, anonymousEnabled, index),
  })))
```

`flatMap` 是因為一個學生可能放了好幾個標記 —— 一筆作答攤平成多個標記。
`index` 是**作答的序號**不是標記的序號，所以同一個學生的三個標記共用同一個字母／數字，
在圖上看得出來是同一個人點的。

摘要行要把人數與標記數分開講：

```tsx
<p className="muted">
  已作答 {current.length} 人 · 共 {pins.length} 個標記
  {question.max_pins && question.max_pins > 1 ? `（每人最多 ${question.max_pins} 個）` : ''}
  {question.answer_round > 1 ? ` · 第 ${question.answer_round} 輪` : ''}
</p>
```

每人可點多次時，「31 個標記」和「12 人」是兩個不同的數字，只講一個會誤導。
每人只能點一次時上限那句不顯示 —— 說「每人最多 1 個」是廢話。

面板本體是一個可點的縮圖：

```tsx
{screenshotUrl
  ? (
    <button className="hotspot-thumb-button" title="放大檢視點選結果" type="button" onClick={enlarge}>
      <HotspotImage alt="學生點選結果" imageUrl={screenshotUrl} pins={pins} />
    </button>
  )
  : <p className="muted">找不到這一題的截圖。</p>}
```

不傳 `onPlace` 與 `onRemove`，所以同一個元件在這裡是唯讀的。
找不到截圖時要講人話，不要畫一個空框。

## 放大檢視：兩條路

老師端的面板是班級清單旁邊的一欄，裡面的圖是縮圖大小 —— 而這一題的整個結果就是那張圖。
縮圖上看不出十八個標記擠在哪裡，所以放大不是加分功能，是必要的。

```ts
// 和自訂測驗同一個手勢：桌面版開一個真的視窗，其他環境開全螢幕覆蓋層。
function enlarge() {
  if (window.interactDesktop) {
    void window.interactDesktop.openHotspotReview(question.session_id, question.id)
    return
  }
  setExpanded(true)
}
```

**桌面版開獨立視窗**的理由是實際的：老師可以把它丟到第二個螢幕或投影幕上，
自己的主控視窗留在筆電上繼續操作。覆蓋層做不到這件事。

**網頁版的覆蓋層**用 portal 掛到 `document.body`，避開面板的 `overflow` 與層疊脈絡：

```tsx
{expanded && screenshotUrl && createPortal(
  <div className="custom-quiz-review-backdrop" role="presentation"
       onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false) }}>
    <section aria-label="圖上點選放大檢視" aria-modal="true" className="hotspot-review-modal" role="dialog">
      <header>
        <h2>{question.prompt_text || question.title}</h2>
        <button aria-label="關閉放大視窗" className="icon-button" title="關閉" type="button"
                onClick={() => setExpanded(false)}><X size={22} /></button>
      </header>
      <div className="hotspot-review-stage">
        <HotspotImage alt="學生點選結果" imageUrl={screenshotUrl} pins={pins} />
      </div>
    </section>
  </div>,
  document.body,
)}
```

關閉用 `onMouseDown` 加 `event.target === event.currentTarget`，不是 `onClick`。
用 `onClick` 的話，在圖上按下、拖曳到外面才放開，也會被當成點擊背景而關掉視窗。

## 獨立視窗頁

桌面版的視窗底下沒有教師頁，所以它自己去抓資料。

```tsx
export function HotspotReviewPage() {
  const { sessionId = '', questionId = '' } = useParams()
  const [result, setResult] = useState<HotspotResult | null>(null)
  const [anonymous, setAnonymous] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setError('找不到講者權限，請關閉視窗後重新開啟。')
      return
    }
    const { data, error: loadError } = await requireSupabase().functions.invoke('presenter-action', {
      body: { action: 'get_hotspot_result', sessionId, presenterToken, questionId },
    })
    if (loadError || !data?.question) {
      setError(data?.message || '無法載入這一題。')
      return
    }
    setResult(data as HotspotResult)
    setError('')
  }, [questionId, sessionId])

  useEffect(() => {
    void load()
    // 視窗開著的時候學生還在點，圖要跟得上。
    const timer = window.setInterval(() => void load(), 2500)
    return () => window.clearInterval(timer)
  }, [load])
  ...
}
```

**輪詢而不是 Realtime**：這個視窗的生命週期是幾分鐘，2.5 秒一次的輪詢足夠跟上課堂節奏，
而且比在一個獨立視窗裡重建整套訂閱與重連邏輯簡單得多。
`useCallback` 加上 `[load]` 相依，讓 session 或題目換掉時計時器自己重建。

視窗自己帶一個**匿名顯示**切換 —— 老師可能想把它投出去給全班看，
但主控視窗上的匿名設定不一定是他這一刻要的。

## 端點

```ts
if (action === 'get_hotspot_result') {
  const questionId = input.questionId
  if (!validUuid(questionId)) return jsonResponse({ message: '題目資料格式不正確。' }, 400)
  const { data: question, error: questionError } = await supabase
    .from('questions')
    .select('id, type, title, prompt_text, max_pins, answer_round, screenshot_id')
    .eq('id', questionId).eq('session_id', sessionId).maybeSingle()
  if (questionError) throw questionError
  if (!question || question.type !== 'hotspot') return jsonResponse({ message: '這一題不是圖上點選。' }, 404)

  const [{ data: answers, error: answerError }, { data: shot }] = await Promise.all([
    supabase.from('answers').select('participant_name, answer_values, round')
      .eq('question_id', questionId).eq('session_id', sessionId).order('submitted_at'),
    question.screenshot_id
      ? supabase.from('screenshots').select('public_url').eq('id', question.screenshot_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  if (answerError) throw answerError
  return jsonResponse({ question, answers: answers || [], imageUrl: shot?.public_url || null })
}
```

- `.eq('session_id', sessionId)` 和 `presenterToken` 的驗證一起構成授權 ——
  光有 questionId 不足以讀到別人場次的資料。
- `.order('submitted_at')` 讓標記的編號在每次輪詢之間保持穩定。
  沒有排序，同一個學生的字母會在兩次更新之間跳來跳去。
- 兩個查詢用 `Promise.all` 併發，因為每 2.5 秒就要跑一次。
- **所有輪次的答案都回傳**，由前端過濾當前輪。這樣切換輪次不必再跑一趟。

## 桌面視窗的接線

```js
// electron/main.cjs
ipcMain.handle('window:open-hotspot-review', (_event, sessionId, questionId) => {
  createQuestionDetailWindow(`/hotspot-review/${sessionId}/${questionId}`, 'InterAct 圖上點選檢視')
})

// electron/preload.cjs
openHotspotReview: (sessionId, questionId) =>
  ipcRenderer.invoke('window:open-hotspot-review', sessionId, questionId),
```

路由只在桌面版開放，網頁版直接導回首頁 —— 這個路由只對一個能讀到 presenter token 的環境有意義：

```tsx
<Route path="/hotspot-review/:sessionId/:questionId"
       element={isDesktop ? <HotspotReviewPage /> : <Navigate to="/" replace />} />
```

App 外層也要知道這是一個獨立視窗，不要畫主框架：

```tsx
const isHotspotReview = location.pathname.startsWith('/hotspot-review/')
```

## 匯出

熱點題的答案進 Excel 的「答案」工作表，和其他題型共用同一張表，不另開一張：

| 欄位 | 熱點題填什麼 |
| --- | --- |
| 題型 | `圖上點選` |
| 選項答案 | 座標串以頓號相連：`0.4312,0.2871、0.5108,0.6640` |
| 正確性 | `未判定`（`is_correct` 永遠是 null） |

座標對著報表讀沒有意義，但它讓那一列保持完整、可稽核，而且能重新畫回圖上。
不要為了好看而在匯出時把它丟掉。

「正確性」欄要能表達**三種**狀態。把 null 當成 falsy 寫成「錯誤」，
會讓整張熱點題與無標準答案題目的作答全部顯示成答錯：

```ts
correctness: answer.is_correct === null ? '未判定' : answer.is_correct ? '正確' : '錯誤'
```
