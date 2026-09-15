# 姓名正規化與比對

比對用正規化後的字串，**顯示一律用原字串**。這條分界要一直守住：
正規化是為了判斷「這兩個是不是同一個人」，不是為了決定畫面上寫什麼。

## 正規化

```ts
// Everything that separates two names that are the same name. Spaces are the
// obvious one — 王 小明 and 王小明 — but a list pasted out of Excel carries far
// worse: ideographic spaces, non-breaking spaces, zero-width joiners left by a
// copy, and three different interpuncts that all get used for the same break in
// an indigenous name.
const SEPARATORS = /[\s 　​-‍﻿・·•‧∙⋅･.]/g

export function normalizeName(value: string) {
  if (!value) return ''
  // NFKC first: it folds full-width Latin letters onto their ASCII forms.
  return value.normalize('NFKC').toLowerCase().replace(SEPARATORS, '')
}
```

每一個字元都對應一種實際會出現的來源：

| 字元 | 從哪裡來 |
| --- | --- |
| `\s` | 一般空格、Tab |
| ` ` NBSP | 從網頁或 Word 複製 |
| `　` 全形空格 | 中文輸入法，**肉眼與半形空格幾乎分不出來** |
| `​`–`‍` 零寬字元 | 複製貼上的殘留，**完全看不見** |
| `﻿` BOM | 檔案開頭，會黏在第一個名字上 |
| `・` `·` `‧` `∙` `⋅` `･` | 原住民姓名的間隔點，**六種寫法都有人用** |
| `.` | 英文名字縮寫 |

NFKC 要放在最前面：它把全形英數折成半形，所以中文輸入法打出來的學號和學校系統匯出的半形學號能對上。

學號用同一套規則比對：

```ts
export function normalizeStudentNo(value: string) {
  return value ? value.normalize('NFKC').toLowerCase().replace(SEPARATORS, '') : ''
}
```

## 不要做繁簡轉換

即使專案裡已經有轉換器（字幕可能用得到），**人名不要用**：

```
余/餘   范/範   沈/瀋   于/於   台/臺
```

這些都是真的姓氏。轉換會把它們改掉，結果是本來對得上的變成對不上，
或是兩個不同的人被歸成同一個。少數簡體名單對不上，遠比默默改掉人家的姓好。

```ts
// Deliberately no simplified-to-traditional conversion here, although the
// project carries a converter for captions. Personal names are the one place it
// is unsafe: 余/餘, 范/範, 沈/瀋, 于/於 and 台/臺 are all real surnames that a
// conversion will happily rewrite, which would break a match that worked or
// merge two people who are not the same person.
```

## 比對

每次 render 重算，不儲存結果。沒有任何東西依賴上一次的結果，
所以遲到的學生下一次 render 就會自己亮起來。

```ts
export function matchRoster(
  entries: RosterEntry[],
  participants: Array<{ id: string; name: string }>,
) {
  const byName = new Map<string, string[]>()
  for (const participant of participants) {
    const key = normalizeName(participant.name)
    if (!key) continue
    const bucket = byName.get(key)
    if (bucket) bucket.push(participant.id)
    else byName.set(key, [participant.id])
  }

  const claimed = new Set<string>()
  const matches: RosterMatch[] = entries.map((entry) => {
    const bucket = byName.get(normalizeName(entry.name)) || []
    // One participant answers for at most one line on the list. Two students
    // called 陳怡君 who both joined get one line each rather than both lighting
    // up the first line and leaving the second looking absent.
    const participantId = bucket.find((id) => !claimed.has(id)) || null
    if (participantId) claimed.add(participantId)
    return { entry, participantId }
  })

  return { matches, matchedParticipantIds: claimed }
}
```

**`claimed` 這個集合是重點。** 沒有它的話，名單上兩個都叫「陳怡君」的人，
會同時對到第一個加入的陳怡君 —— 第一列亮兩次，第二列看起來沒到。
有了它，兩個人各佔一列。

`matchedParticipantIds` 同時也是「誰不在名單上」的答案：沒被認領的 participant 就是。

## 同名同姓

正規化再完美也分不出兩個真的同名的人。這是學號欄位存在的理由。
匯入時偵測並提醒老師去補：

```ts
export function duplicateNames(entries: RosterEntry[]) {
  const seen = new Map<string, number>()
  for (const entry of entries) {
    const key = normalizeName(entry.name)
    if (key) seen.set(key, (seen.get(key) || 0) + 1)
  }
  return new Set([...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key))
}
```

## 測試

這是整套功能裡最該先寫測試的部分 —— 它是純函式，而它要處理的字元**大部分肉眼看不見**。
在瀏覽器裡用眼睛驗證零寬字元有沒有被清掉，是不可能的。

實際驗過的案例：

```
王 小明        -> 王小明          半形空格
王　小明        -> 王小明          全形空格 U+3000
巴那嗨・熱柯    -> 巴那嗨熱柯       U+30FB
巴那嗨·熱柯     -> 巴那嗨熱柯       U+00B7
巴那嗨‧熱柯     -> 巴那嗨熱柯       U+2027
​陳怡君﻿ -> 陳怡君        零寬 + BOM
Ｊｏｈｎ Ｓｍｉｔｈ -> johnsmith    全形英文 + NFKC
O Brien   -> obrien          NBSP
```

比對層面：

```
名單 [王 小明, 陳怡君, 陳怡君, 巴那嗨・熱柯, 林志玲]
加入 [王小明, 陳怡君, 陳　怡君, 巴那嗨‧熱柯, 不在名單的人]

王 小明      -> p1
陳怡君       -> p2
陳怡君       -> p3   ← 兩個同名各自認領，不是都對到 p2
巴那嗨・熱柯  -> p4   ← 不同的間隔點
林志玲       -> 未到
不在名單的人  -> 不在名單
同名偵測     -> 陳怡君
```

## 合併成三種列

```ts
if (!roster) {
  // No list in use: exactly the behaviour that existed before.
  return computed.map((row) => toRow(row, row.participant.name, '', '', false, row.participant.id))
}

const { matches, matchedParticipantIds } = matchRoster(roster.entries, participants)

// The class list first, in the order the presenter put it in, so a teacher
// reading down it is reading their own list. The name shown is the one on the
// list, not the one the student typed — that is the whole point of matching,
// and the two differ by exactly the spacing being ignored.
const listed = matches.map(({ entry, participantId }) => toRow(
  participantId ? byParticipantId.get(participantId) || null : null,
  entry.name, entry.studentNo, entry.unit, true, entry.id,
))

// Whoever typed something that is not on the list still joined, under what they
// typed. They are not an error, just not identified.
const unlisted = computed
  .filter((row) => !matchedParticipantIds.has(row.participant.id))
  .map((row) => toRow(row, row.participant.name, '', '', false, row.participant.id))

return [...listed, ...unlisted]
```

名單那一段**照老師自己排的順序**，不要重新排序 —— 他讀的是他自己的點名單。

排序時未到的沉到最底：

```ts
if (a.online !== b.online) return a.online ? -1 : 1
if (Boolean(a.participation) !== Boolean(b.participation)) return a.participation ? -1 : 1
```

## 沒有名單時不能有任何改變

`if (!roster)` 那條分支要走回原本的行為，一行都不差。
大多數場次不會用名單，那些場次不應該因為這個功能而看起來不一樣。
