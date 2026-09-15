# 加分與移出名單

這兩件是整套功能裡唯一需要碰資料庫的部分，而且兩個都有一個不明顯的正確做法。

## 移出名單：不要刪那一列

學生把自己的名字打錯了，而他**沒辦法自己更正** ——
加入是綁裝置的，重新掃碼只會把第一次打的名字還給他。所以需要一個「移出」讓他重來。

直覺的做法是刪掉他的 participant 資料列。**千萬不要。**
他的作答、訊息、錄音、上傳檔案、測驗紀錄全部用 `on delete cascade` 掛在那一列上 ——
刪掉他等於把這堂課的證據一起刪掉。

而「標記為已移除然後讓他重新加入」也行不通：`unique (session_id, device_id)` 會擋住同一台裝置再次插入。

**正確做法：改寫 device_id。**

```ts
// The row is kept. Every answer, message, recording and upload they made hangs
// off it by a cascading key, so deleting it would take this lesson's evidence
// with it. Rewriting the device id is what actually frees them: unique
// (session_id, device_id) would otherwise hand that phone back this very row —
// under the name being corrected — the moment it rejoined.
const { data: updated } = await supabase
  .from('participants')
  .update({
    removed_at: new Date().toISOString(),
    device_id: `removed:${Date.now()}:${participant.device_id}`.slice(0, 200),
  })
  .eq('id', participantId)
  .select('*').maybeSingle()

// Their token stops working immediately, so anything already in flight is
// refused rather than landing under the name that is being replaced.
await supabase.from('participant_session_keys').delete().eq('participant_id', participantId)
```

於是：

- 歷史資料一筆都沒動，全部掛在舊列上
- unique 不再衝突，那台裝置重新加入會建立一列全新的
- `removed_at` 讓畫面把舊列藏起來，報表裡卻留著（標「已移出」）

`removed_at` 是用來判斷的欄位，不要去解析 device_id 的前綴 —— 那是給人看的線索，不是給程式用的。

## 學生端必須自己發現

這一步很容易漏掉，漏了的話「移出」在學生那一端等於沒有作用。

被移出的學生，他的 localStorage 還留著 participant id，而**那一列還存在**（我們沒刪），
所以任何「資料還在不在」的檢查都會通過。他會停在一個每個動作都被拒絕的頁面上，
看起來像 app 壞了，而不是像「請重新輸入姓名」。

判斷要用 `removed_at`：

```tsx
// The presenter removed them so they can rejoin under the name on the class
// list. The row is still there — it holds everything they answered — so the
// fetch above succeeds and nothing else would notice; without this they sit on
// a page whose every action is refused, which reads as the app being broken
// rather than as an instruction to type their name again.
useEffect(() => {
  if (!participant?.removed_at) return
  localStorage.removeItem(`interact_participant_${sessionId}`)
  localStorage.removeItem(`interact_participant_token_${sessionId}`)
  localStorage.removeItem(`interact_name_${sessionId}`)
  navigate(`/join/${sessionId}`, { replace: true })
}, [navigate, participant?.removed_at, sessionId])
```

注意**不要**靠「token 失效」來偵測 —— 那要等到下一次 API 呼叫才會發生，
而一個只是坐著看的學生可能很久都不會呼叫任何東西。

## 加分：只加，但要能撤銷

「只加分不減分」是對的教學決定 —— 一顆會扣分的按鈕在課堂上是另一種東西。
但**一顆只能加的按鈕，手滑一次數字就永遠錯了**。

撤銷不是扣分。它刪掉最後一筆加分紀錄，總分回到原來的樣子；扣分則是記一筆負的。
兩者在報表上看起來完全不同，一個是「沒發生過」，一個是「被懲罰了」。

```ts
// Undoing a stray tap, which is not the same thing as deducting a point: it
// removes the last award rather than recording a negative one, so the total
// goes back to what it was instead of reading as a punishment.
if (action === 'revoke_participant_point') {
  const { data: latest } = await supabase
    .from('participant_points')
    .select('id')
    .eq('session_id', sessionId).eq('participant_id', participantId)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  if (!latest) return jsonResponse({ message: '這位學員目前沒有加分紀錄。' }, 404)
  await supabase.from('participant_points').delete().eq('id', latest.id)
  return jsonResponse({ ok: true })
}
```

逐筆存而不是存總分，才有「最後一筆」可以刪，報表也才能列明細。

授權：加分要驗證 participant **屬於這個 session**，否則一個從別的班拿到的 id
就能用這個班的 token 加分。

```ts
const { data: participant } = await supabase
  .from('participants')
  .select('id, removed_at')
  .eq('id', participantId).eq('session_id', sessionId).maybeSingle()
if (!participant) return jsonResponse({ message: '找不到這位學員。' }, 404)
if (participant.removed_at) return jsonResponse({ message: '這位學員已被移出名單。' }, 409)
```

---

# 新增資料表的四件事

**這一段是整份 skill 裡最該記住的部分。** 它讓一個功能完整地出貨、通過型別檢查、
通過建置、在資料庫裡正確地寫入資料，然後在畫面上完全沒有作用。

加一張表到 schema 要做**四件事**：

**1. 建表，而且要能在既有專案上生效**

```sql
create table if not exists public.participant_points (...);

-- 以及檔案後段的遷移區塊，否則已經部署過的專案永遠不會長出新欄位
alter table public.participants add column if not exists removed_at timestamptz null;
```

`create table if not exists` 對已存在的表**什麼都不做**，所以新欄位一定要另外寫 `add column if not exists`。

**2. RLS policy**

```sql
alter table public.participant_points enable row level security;
create policy "mvp read participant points" on public.participant_points for select using (true);
```

**3. 加進 grant 清單 ← 就是這一步被漏掉**

```sql
-- 這一行把所有權限收回
revoke all on all tables in schema public from anon, authenticated;
-- 然後逐張表發回去。沒被列在這裡的表，等於沒有人讀得到。
grant select on public.sessions, public.questions, ..., public.participant_points to anon, authenticated;
```

**policy 不會授予任何權限。** policy 決定「哪些列看得到」，grant 決定「這個角色能不能碰這張表」。
兩個都要。少了 grant，讀取回傳權限錯誤。

**4. 加進 realtime 發佈**

```sql
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'participant_points'
  ) then
    alter publication supabase_realtime add table public.participant_points;
  end if;
end $$;
```

## 不要在 policy 旁邊寫局部的 revoke

我寫了這一行：

```sql
revoke insert, update, delete on public.participant_points from anon, authenticated;
```

它**完全沒有作用** —— 後面那個 `revoke all on all tables` 早就涵蓋了。
但它造成的傷害是真的：它讀起來像是「這張表的權限已經處理過了」，
所以再也沒有人（包括我自己）去看真正的 grant 清單。

**一行看起來像答案的程式碼，會讓人停止尋找真正的答案。**

## 為什麼沒被發現

症狀是：按 ＋ 沒有反應，數字永遠是 0。沒有錯誤訊息。
而資料庫裡，每一次點擊都成功寫入了。

兩個機制讓它沉默：

```ts
// 權限錯誤回傳 { data: null, error }，這個寫法把它變成「沒有資料」
setPoints((pt.data || []) as ParticipantPoint[])
```

以及：**schema 是 build 時打包進 app 的**（`import.meta.glob` + `eager: true`），
所以用舊版 app 重跑自動部署，只會重新套用舊的 schema。修好 schema 之後必須重新打包。

修法兩邊都要：

```ts
if (pt.error) {
  setError('讀不到加分紀錄，可能是資料庫還沒更新。請到系統設定重跑一次自動部署。')
  return
}
```

## 驗證，不要相信

加完表之後，直接去問資料庫：

```sql
select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) as privs
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name in ('participant_points', 'participants')
  and grantee in ('anon', 'authenticated')
group by table_name, grantee;
```

新表如果沒有出現在結果裡，就是**零權限**。跟一張正常運作的表並排比較，
差異會立刻跳出來 —— 這正是這個 bug 最後被抓到的方式。
