---
name: class-roster-attendance
description: Build a reusable class roster with live attendance matching for a classroom tool — importing names from CSV/Excel, matching what students type against the list without turning anyone away, awarding points, and removing someone so they can rejoin under a corrected name. Covers why the roster stays off the server, the name normalisation that makes 王 小明 and 王小明 the same person, and the silent-failure modes that make all of this look broken. Use when adding attendance, a student list, roll call, or participant identity reconciliation to a live session tool.
---

# 班級名單與點名：完整實作規格

一份老師可以重複使用的班級名單，匯入之後和實際加入的學員即時比對：
對得上的算出席，對不上的照樣加入，名單上沒人認領的就是未到。另外兩件相關的事：加分與移出名單。

內容來自實際運作的程式碼，演算法、正規化規則與 SQL 都是逐字抄錄。
實作是 React 19 + TypeScript + Supabase + Electron，但最重要的那個決定與堆疊無關。

## 最重要的決定：名單不進資料庫

這是整套設計的樞紐，而且理由是**架構上的**，不是偷懶。

系統裡沒有「教師」這個身分。能用來授權的只有兩樣東西：一個只對**單一場次**有效的 presenter token，
以及整個部署的管理金鑰。**沒有任何跨場次的身分。**
而可重複使用的班級名單正是跨場次的資料，裡面還有姓名與學號。

所以問題不是「要不要把名單存進資料庫」，而是「存進去之後，資料庫要用什麼來判斷誰能讀它」——
這個問題沒有答案，除非先發明一套帳號系統。

**解法：名單存在老師自己的電腦上。** 三件事讓這個解法成立：

- 每位講師本來就用自己的後端專案，一個部署等於一位老師。「跨場次身分」實際上就是「這台電腦」。
- **比對只是為了顯示**（不擋人），所以伺服器根本不需要知道名單存在。
- **匯出報表是在前端跑的**，所以缺席者的名字可以在本機補進去。

於是整套功能**不新增資料表、不寫 RLS、不改任何 API、個資完全不上傳**。
場次只記一件事：它用的是哪一份名單。

這個結論的前提是「不設門禁」。**一旦要擋人，伺服器就必須認得名單，整個架構立刻改變** ——
先想清楚要不要擋，再決定名單放哪裡。

## 五條規則

1. **不擋任何人。** 打了名單以外的名字照樣加入，用他打的名字顯示，標成「不在名單」；
   名單上那位維持「未到」。老師在台上用嘴巴要求，比系統擋人溫和得多，也不會讓打錯字的學生整堂課進不來。

2. **比對忽略分隔，顯示保留原樣。** 「王 小明」和「王小明」是同一個人。
   但畫面上要顯示名單上寫的那個名字，不是正規化後的字串。
   → [references/name-matching.md](references/name-matching.md)

3. **不要對人名做繁簡轉換。** 余/餘、范/範、沈/瀋、于/於、台/臺 都是真的姓氏，
   轉換會把它們改掉 —— 本來對得上的變成對不上，或兩個不同的人被併在一起。

4. **移出學員時不要刪除他的資料列。** 他的作答、訊息、錄音全部用 cascade 外鍵掛在上面，
   刪除等於把整堂課的證據一起刪掉。
   → [references/points-and-removal.md](references/points-and-removal.md)

5. **加分只加不減，而且要讓老師看的那個數字動。**
   → 下方「加分」與 [references/points-and-removal.md](references/points-and-removal.md)

## 三種列，不是一種

加了名單之後，畫面上的清單從「參與者資料表的直接呈現」變成**兩個集合的聯集**：

| 列的種類 | 有 participant 資料嗎 | 顯示 |
| --- | --- | --- |
| 在名單上，已加入 | 有 | 名單上的姓名 + 綠色勾 |
| 在名單上，沒加入 | **沒有** | 灰階 + 「未到」 |
| 不在名單上，已加入 | 有 | 他打的姓名 + 「不在名單」 |

第二種是關鍵：**它沒有 participant id**，所以所有掛在上面的東西都要是可選的 ——
參與分數、線上狀態、加分、移出，全部不適用。型別要誠實地反映這件事：

```ts
type RosterRow = {
  key: string
  name: string
  studentNo: string
  unit: string
  // Null for a name on the list that nobody has joined under.
  participation: ParticipationRow | null
  online: boolean
  onRoster: boolean
  points: number
}
```

排序也要跟著改：線上的排前面，**已加入的排在未到的前面**，再照原本的排序模式。

計數行要分三個數字，只講一個會誤導：

```
線上 8／已加入 12／名單 30 人
```

## 資料模型

名單在本機（localStorage 就夠，一個班六十人約 6KB）：

```ts
type RosterEntry = { id: string; name: string; studentNo: string; unit: string }
type ClassRoster = { id: string; name: string; updatedAt: string; entries: RosterEntry[] }

const ROSTER_KEY = 'interact:class-rosters'
// 每個場次各自記住用的是哪一份，因為同一台電腦會開好幾個班
const SESSION_ROSTER_PREFIX = 'interact:session-roster:'
```

只有這兩樣進資料庫，而且都跟名單無關：

```sql
-- 加分事件。逐筆存而不是存總分，這樣誤按可以追溯，報表也能列明細。
create table if not exists public.participant_points (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  points integer not null default 1 check (points between 1 and 10),
  created_at timestamptz not null default now()
);

-- 移出名單。資料列留著，只是退出這個班。
alter table public.participants add column if not exists removed_at timestamptz null;
```

**加分事件綁 session，不綁名單。** 綁錯的話，下週用同一份名單上課會把上週的分數帶過來。

## 加分

只加不減。但**一顆只能加的按鈕，手滑一次數字就永遠錯了**，所以要有撤銷 ——
撤銷不是扣分：它刪掉最後一筆加分紀錄，而不是記一筆負的。兩者在報表上看起來完全不同。

顯示上只有一條規則，而且是用踩坑換來的：

```tsx
{/* One number, because pressing + has to move the number the presenter is
    looking at. The split that matters — earned against awarded — is kept
    where it can be audited: its own columns in the exported report. */}
<span className="roster-score" title={[...breakdown, `老師加分 +${row.points}`].join('．')}>
  {participation.score + row.points}
</span>
```

原本的設計把老師加的分放在一顆獨立的徽章裡，讓「參與分數」保持純粹 ——
理由是那個分數必須可稽核，老師被問到「他為什麼 85 分」時要答得出來。
**理由是對的，做法是錯的**：老師按了「加分」，他正在看的那個數字沒有動，那顆按鈕就是壞的。

正確的切法是：**畫面上一個總分，報表裡三欄**（總分／參與分數／老師加分）。
需要稽核的是試算表，不是講台上那一眼。

## 匯出

「參與者」工作表要：

- 新增欄位：學號、系所、出席狀態、總分、老師加分
- **名單上沒到的人也要有一列**，標「未到」—— 那正是一張點名表的用處
- 被移出的人也要有一列，標「已移出」，他的作答還在
- 有加分時另開一張明細（誰、幾分、幾點加的）

匯出在前端跑，所以缺席者直接從本機名單補進去，不必上傳任何東西。

## 兩個讓這一切看起來壞掉的沉默失敗

兩個都實際發生過，兩個都不會報錯，兩個都表現為「按了沒反應」。

**一、新資料表少了 grant。** RLS policy **不會授予任何權限**。
如果 schema 裡有一行 `revoke all on all tables in schema public from anon` 然後再逐張表 grant 回去，
漏掉的那張表就是沒有人讀得到 —— 寫得進去，讀不出來。
症狀：加分全部成功寫入資料庫，畫面上永遠顯示 0。
→ [references/points-and-removal.md](references/points-and-removal.md)

**二、`(result.data || [])` 把錯誤吞掉。**
權限錯誤回傳的是 `{ data: null, error }`，這個寫法讓它變成空陣列，於是畫面顯示「沒有資料」而不是「讀取失敗」。

```ts
setPoints((pt.data || []) as ParticipantPoint[])
// Say so rather than showing a zero. A missing grant on this table comes back
// as an error here and an empty array, so the + button appeared to do nothing
// while every tap was in fact being recorded — the failure looked like a
// broken button instead of a database that had not been brought up to date.
if (pt.error) {
  setError('讀不到加分紀錄，可能是資料庫還沒更新。請到系統設定重跑一次自動部署。')
  return
}
```

**如果 schema 是 build 時打包進 app 的**（例如 Vite 的 `import.meta.glob`），
那麼用舊版 app 重跑自動部署只會重新套用舊 schema。升級說明要講清楚這件事。

## 建議的實作順序

1. 本機名單的儲存與管理 UI（先用手動輸入，不碰檔案）
2. 正規化與比對，**先寫測試**再接 UI → [references/name-matching.md](references/name-matching.md)
3. 三種列的合併與排序
4. 檔案匯入 → [references/file-import.md](references/file-import.md)
5. 匯出補上缺席者
6. 加分與移出名單 → [references/points-and-removal.md](references/points-and-removal.md)

## 驗收清單

- [ ] 匯入一份真實的 csv，**中文沒有亂碼**（Big5 與 UTF-8 兩種都要試）
- [ ] 「王 小明」打成「王小明」仍然對得上；全形空格也是
- [ ] 名單上兩個同名的人都加入 → 各佔一列，不是都對到第一列
- [ ] 打一個名單以外的名字 → 另外一列標「不在名單」，名單上那位維持「未到」
- [ ] 按 ＋ → **名字後面的數字立刻 +1**
- [ ] 移出某人 → 他的手機自己回到輸入姓名的畫面，重打正確姓名能再加入
- [ ] 移出的人，他之前的作答還在報表裡
- [ ] 匯出的「參與者」工作表裡，沒到的人有一列
- [ ] 把新資料表的 grant 拿掉再跑一次 → **畫面要出現錯誤訊息，不是 0**
