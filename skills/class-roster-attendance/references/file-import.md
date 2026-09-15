# 從 CSV 與 Excel 匯入名單

只支援 csv 與 xlsx。舊的二進位 `.xls` 需要另一套函式庫才讀得到一個 2007 年就被取代的格式，
而「另存為 .xlsx」是每個老師都做得到的一步 —— 一句清楚的訊息勝過一 MB 的 parser。

```ts
if (name.endsWith('.xls')) {
  throw new Error('不支援舊版的 .xls，請用 Excel 另存為 .xlsx 或 CSV 後再匯入。')
}
```

## 中文亂碼：CSV 是 Big5

**台灣的 Excel 存 CSV 時用的是系統代碼頁，也就是 Big5，不是 UTF-8。**
（存「CSV UTF-8」才是 UTF-8，而且會帶 BOM。）用 UTF-8 解碼 Big5 檔，整份檔案會變成一片替換字元，
看起來像程式壞了，而不是編碼不對。

偵測方式就是「嚴格模式解碼失敗」—— Big5 的位元組序列幾乎不可能是合法的 UTF-8：

```ts
function decodeText(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes.subarray(3))
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    // Named big5 in the Encoding Standard; Chromium maps it to the same table
    // Windows calls cp950, which is what Excel wrote.
    return new TextDecoder('big5').decode(bytes)
  }
}
```

三個細節：

- **`fatal: true` 是關鍵。** 沒有它，`TextDecoder` 會把壞位元組換成 U+FFFD 而不丟例外，於是永遠不會退回 Big5。
- **BOM 要自己剝掉。** `TextDecoder('utf-8')` 不會移除它，留著會黏在第一個欄位名或第一個名字上。
- 純 ASCII 的檔案兩種解碼結果相同，不影響。

`big5` 是 WHATWG Encoding Standard 的標準名稱，Chromium 內建，不需要額外套件。
Node 要有 full-icu（24 以後預設有）。

## CSV 要用真的 parser

不能用 `split(',')`。一個系所欄位寫成 `"資訊工程學系, 大學部"` 是**一個**被引號包住的欄位，
用逗號切會讓它後面每一欄都位移一格。

```ts
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char !== '"') { field += char; continue }
      // A doubled quote inside a quoted field is one literal quote.
      if (text[index + 1] === '"') { field += '"'; index += 1; continue }
      quoted = false
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { row.push(field); field = ''; continue }
    if (char === '\r') continue
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += char
  }
  if (field || row.length) { row.push(field); rows.push(row) }

  return rows
}
```

三十行，不需要依賴。要處理的情況：引號內的逗號、連續兩個引號代表一個引號、
引號內的換行、CRLF、結尾沒有換行、空欄位要保留。

## xlsx 的儲存格不是字串

一個儲存格可能是公式的計算結果、rich text 的片段、日期或超連結，
這些丟給 `String()` 全都會變成 `[object Object]`：

```ts
function cellText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const record = value as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (Array.isArray(record.richText)) {
    return record.richText.map((run) => String((run as { text?: unknown }).text ?? '')).join('')
  }
  if ('result' in record) return cellText(record.result)
  if ('hyperlink' in record && typeof record.hyperlink === 'string') return record.hyperlink
  return ''
}
```

讀列時**照欄位位置讀，不要迭代存在的儲存格** —— 欄索引是 1 起算而且是稀疏的，
中間有空格的話迭代會讓欄位對錯位置：

```ts
sheet.eachRow((row) => {
  const values: string[] = []
  for (let column = 1; column <= sheet.columnCount; column += 1) {
    values.push(cellText(row.getCell(column).value))
  }
  rows.push(values)
})
```

## 補齊不整齊的列

匯出的檔案常常有些列比標頭短。不補齊的話，某一欄讀到一半會變成 `undefined`：

```ts
const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
const padded = rows
  .map((row) => Array.from({ length: width }, (_, index) => (row[index] ?? '').trim()))
  .filter((row) => row.some(Boolean))
```

沒有標頭的檔案（第一列就是資料）要給一個「第一列是標題」的勾選，預設打勾。
沒有標頭時用 `第 N 欄` 當欄位名，讓選單有東西可選。

## 欄位對應

用下拉選單，不要用勾選框 —— 這是一對一的對應（「姓名是哪一欄」），
選單能表達，勾選框不能。非必填的欄位多一個「不匯入」選項。

學校系統匯出的檔案通常自己就寫了欄位名，猜對可以省掉三次點擊：

```ts
const NAME_HINTS = ['姓名', '名字', '學生姓名', '學員姓名', 'name', 'student name', '中文姓名']
const STUDENT_NO_HINTS = ['學號', '學生證號', '座號', '編號', 'student id', 'student no', 'id']
const UNIT_HINTS = ['系所', '單位', '班級', '科系', '部門', 'class', 'department', 'unit', 'group']
```

先找完全相符，再找包含。姓名欄猜不到時**退回第一欄** ——
一份沒有標頭的名單就是一欄名字，讓老師去選一個只有一種答案的問題是多餘的。

## 貼上一整排名字

沒有檔案的時候名單是從 email、聊天訊息或 PDF 來的。換行、逗號、頓號、全形逗號、Tab、分號都算分隔，
因為來源不同就會出現不同的那一種：

```ts
export function parsePastedNames(text: string) {
  return text
    .split(/[\n\r,、，\t;；]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => newEntry(name))
}
```

## 匯入之後要能改

匯入不是終點。AI 猜錯欄位、名單裡有不該在的人、有人臨時加選 ——
所以匯入後的每一列都要能逐欄編輯、能刪、能手動加。
匯入本身也要能選「取代現有名單」或「加到後面」。

## 測試

parser 與解碼是純函式，先寫測試。實際驗過的十個案例：

```
一般列、引號內含逗號、連續兩個引號、引號內換行、CRLF、
結尾無換行、空欄位保留、UTF-8 BOM 剝除、UTF-8 無 BOM、Big5 退回
```

測 Big5 時要自己造位元組。注意**手寫的測試資料本身也會錯** ——
第一次測試失敗是因為我把 `姓` 寫成 `A7 6D`（那是 `吮`），正確的是 `A9 6D`。
解碼路徑其實是對的，是測試資料錯了。
