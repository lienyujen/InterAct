# 資料模型與批改

## 核心決定：答案存在另一張表

題目表是全班可讀的 —— 學生的瀏覽器要訂閱它才能收到新題目。
只要正確答案是題目的一個欄位，任何學生打開 devtools 就能在作答前看到答案。

所以答案存在 `question_keys`，這張表**撤銷 anon 的讀取權限**，只有伺服器端（service role）讀得到。
批改在伺服器端做，回給學生的只有 `isCorrect` 布林值，答案本身永遠不回傳。

這帶來一個副作用：**教師自己的頁面也讀不到答案**，必須另外呼叫一個 endpoint 去拿。
結果面板因此有一個「答案還沒載入」的中間狀態（`orderingKey === null`），UI 必須處理它。

## 資料表

```sql
create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  screenshot_id uuid null references public.screenshots(id) on delete set null,
  type text not null check (type in (..., 'ordering', 'matching')),
  status text not null default 'active',   -- draft | active | stopped | closed
  title text not null,
  prompt_text text null,

  -- 排序題：要排的項目，派送時已經打散
  -- 配對題：左側固定不動的題目欄
  options jsonb not null default '[]'::jsonb,

  -- 配對題專屬：被選的那一側，已打散。排序題留空。
  -- options 與 choices 都是公開的；祕密只有兩者之間的對應關係。
  choices text[] not null default '{}'::text[],

  -- 排序題專屬：這些碎片是一個句子切開來的，不是一組要排名的項目。
  -- 長度分辨不出來 —— 四個短意見和四個詞看起來一模一樣 —— 所以由老師在派送時指定。
  sentence_mode boolean not null default false,

  -- 是否把出題用的截圖一起給學生看。
  -- 以圖為主的題型預設 true；排序題與配對題要老師明確勾選，
  -- 因為切圖排序的原圖就是答案。
  share_screenshot boolean not null default true,

  -- 再做一次會把這個加一。答案帶著自己那一輪的編號。
  answer_round integer not null default 1,

  answer_seconds integer null,      -- null = 不限時
  started_at timestamptz null,
  stopped_at timestamptz null,
  created_at timestamptz not null default now()
);

-- 答案。anon 沒有 select 權限。
create table if not exists public.question_keys (
  question_id uuid primary key references public.questions(id) on delete cascade,
  session_id uuid not null references public.sessions(id) on delete cascade,
  -- 排序題：正確的順序。
  -- 配對題：每個左側題目對應的右側答案，順序與 questions.options 相同。
  correct_values text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

create table if not exists public.answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  question_id uuid not null references public.questions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  participant_name text not null,
  answer_value text null,
  answer_values text[] null,    -- 排序題與配對題用這個
  answer_text text null,
  is_correct boolean null,      -- null = 這題沒有標準答案，不是「還沒批改」
  submitted_at timestamptz not null default now(),
  round integer not null default 1,
  unique (question_id, participant_id, round)
);
```

**`is_correct` 的三態**：`true` 答對、`false` 答錯、`null` 這題沒有答案可對。
UI 每一處都必須分開處理這三種，把 `null` 當成 falsy 會讓無標準答案的題目全班顯示「答錯」。

**`unique (question_id, participant_id, round)`** 讓同一輪只能交一次，但再做一次開新的一輪之後可以再交。
違反時 Postgres 回 `23505`，要轉成人話：`這一輪你已經作答過了。`

## 兩邊都要的型別

```ts
export type QuestionKey = { choices: string[]; correctValues: string[] }

export type DispatchRequest = {
  type: QuestionType
  options: string[]
  promptText: string
  key: QuestionKey
  timing: { prepareSeconds: number | null; answerSeconds: number | null }
  // 排序題且勾了截圖分割時：要切幾塊。null 表示一般的文字排序題。
  sliceCount: number | null
  // 切圖排序是否對照原圖批改。預設 false。
  sliceHasAnswer: boolean
  sentenceMode: boolean
  shareScreenshot: boolean
}
```

## 學生送出：走伺服器，不要直接寫入

一般題型（選擇、是非）可以讓瀏覽器直接 insert 到 `answers`，用資料庫政策擋住截止時間。
排序題與配對題不行 —— 批改需要讀答案，而學生讀不到。

所以走一個 `submit_ordered_answer` 的伺服器端 action。以下是完整流程，每一個檢查都有理由：

```ts
if (action === 'submit_ordered_answer') {
  const participant = await verifyParticipant(supabase, sessionId, participantId, participantToken)
  if (!participant) return jsonResponse({ message: '學員權限驗證失敗，請重新掃描 QR Code 加入。' }, 403)

  const questionId = typeof input.questionId === 'string' ? input.questionId : ''
  if (!validUuid(questionId)) return jsonResponse({ message: '題目資料不正確。' }, 400)

  // 上限是防呆，不是規則：截斷過長字串、限制陣列長度
  const values = Array.isArray(input.values)
    ? input.values.filter((v: unknown): v is string => typeof v === 'string')
        .map((v) => v.slice(0, 500)).slice(0, 20)
    : []
  if (!values.length) return jsonResponse({ message: '請先完成作答。' }, 400)

  const { data: question } = await supabase.from('questions')
    .select('id, type, status, options, answer_round, answer_seconds, started_at')
    .eq('id', questionId).eq('session_id', sessionId).maybeSingle()
  if (!question || !['ordering', 'matching'].includes(question.type)) {
    return jsonResponse({ message: '找不到這一題。' }, 404)
  }
  if (question.status !== 'active') return jsonResponse({ message: '本題已停止作答。' }, 409)

  // 關鍵：這條路以 service role 執行，會跳過資料庫政策，
  // 所以政策上那條截止時間規則必須在這裡重做一次。
  // 多給三秒，體諒訊號差的手機。
  if (question.answer_seconds && question.started_at) {
    const closesAt = new Date(question.started_at).getTime() + (question.answer_seconds + 3) * 1000
    if (Date.now() > closesAt) return jsonResponse({ message: '作答時間已經結束。' }, 409)
  }

  const { data: activeSession } = await supabase.from('sessions').select('status').eq('id', sessionId).maybeSingle()
  if (activeSession?.status !== 'active') return jsonResponse({ message: '課程已經結束。' }, 409)

  // 數量不符代表客戶端被改過，或題目在作答中換掉了
  if (values.length !== (question.options as string[]).length) {
    return jsonResponse({ message: '作答數量與題目不符。' }, 400)
  }

  const { data: key } = await supabase.from('question_keys')
    .select('correct_values').eq('question_id', questionId).maybeSingle()

  // 沒有答案代表老師要的是意見不是答案，存成未批改，面板改看分布
  const correct = key?.correct_values as string[] | undefined
  const isCorrect = correct?.length
    ? correct.length === values.length && correct.every((value, index) => value === values[index])
    : null

  const { data: saved, error: insertError } = await supabase.from('answers').insert({
    session_id: sessionId,
    question_id: questionId,
    participant_id: participantId,
    participant_name: participant.name,
    answer_values: values,
    is_correct: isCorrect,
    round: question.answer_round,
  }).select('*').maybeSingle()
  if (insertError) {
    if (insertError.code === '23505') return jsonResponse({ message: '這一輪你已經作答過了。' }, 409)
    throw insertError
  }

  // 只回傳對錯，答案本身絕不回傳
  return jsonResponse({ answer: saved, isCorrect })
}
```

**兩種題型的批改是同一段程式碼**，因為兩者的答案都是「一個依位置比對的字串陣列」：

- 排序題：`values[i]` 是排在第 i 位的項目
- 配對題：`values[i]` 是 `options[i]` 這題被指派的答案

這個共通的表示法是整個設計能簡潔的原因，不要為配對題另外發明一種格式。

## 派送時寫入答案

建立題目時，只有在答案非空的情況下才寫 `question_keys`：

```ts
// 題目表是全班可讀的，答案存在上面等於在 devtools 裡公布
if (correctValues.length) {
  const { error: keyError } = await supabase.from('question_keys')
    .insert({ question_id: question.id, session_id: sessionId, correct_values: correctValues })
  if (keyError) throw keyError
}
```

## 事後才設定答案

老師可以先派出一題沒有答案的排序題，讓全班吵完，再設定答案。
已經收到的每一筆作答都要重新批改。

`set_ordering_key` 收到空陣列時代表**改回無標準答案** —— 這條退路一定要留，
否則一次設錯就會讓全班永遠掛著答錯，沒有辦法回頭。

驗證時**不要去重**。重複的項目正是要抓的錯誤，靜靜地合併掉會讓它以「數量不符」的形式回報，
而不是以「你填了兩個一樣的」回報。

## 教師端讀答案

因為 anon 讀不到 `question_keys`，教師頁面要呼叫 `get_ordering_key` 取回。
在取回之前，前端狀態是 `null`（不是 `[]`），UI 用這個區別「還在載入」與「確定沒有答案」。
