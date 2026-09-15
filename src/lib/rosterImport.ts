// Reading a class list out of whatever the office system exported.
//
// Only csv and xlsx. The old binary .xls needs a second library to read a format
// Microsoft replaced in 2007, and "save as .xlsx" is a step every teacher can
// take; a clear message beats a megabyte of parser.

export type Table = {
  headers: string[]
  rows: string[][]
}

// Taiwanese Excel writes csv in the system codepage, which is Big5 — not UTF-8.
// Decoded as UTF-8 the whole file comes back as replacement characters and the
// import looks broken rather than mis-encoded. Strict mode is the detector:
// Big5 bytes are almost never valid UTF-8, so a throw means fall back.
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

// RFC 4180 rather than split(','): a unit column reading 資訊工程學系, 大學部 is
// one quoted field, and splitting on the comma inside it shifts every column
// after it by one.
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

function toTable(rows: string[][], hasHeader: boolean): Table {
  // A ragged export — some rows shorter than the header — would otherwise read
  // as undefined halfway through a column.
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0)
  const padded = rows
    .map((row) => Array.from({ length: width }, (_, index) => (row[index] ?? '').trim()))
    .filter((row) => row.some(Boolean))

  if (!padded.length) return { headers: [], rows: [] }
  if (!hasHeader) {
    return { headers: padded[0].map((_, index) => `第 ${index + 1} 欄`), rows: padded }
  }
  const [header, ...body] = padded
  // An unnamed column still needs something to show in the picker.
  return { headers: header.map((name, index) => name || `第 ${index + 1} 欄`), rows: body }
}

async function readXlsx(file: File, hasHeader: boolean): Promise<Table> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('這個 Excel 檔裡沒有工作表。')

  const rows: string[][] = []
  sheet.eachRow((row) => {
    const values: string[] = []
    // Column indices are 1-based and sparse, so read by position rather than
    // iterating the cells that happen to exist.
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      values.push(cellText(row.getCell(column).value))
    }
    rows.push(values)
  })
  return toTable(rows, hasHeader)
}

// A cell can hold a formula result, a rich-text run, a date or a hyperlink, and
// every one of those stringifies to [object Object] if handed to String().
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

export async function readRosterTable(file: File, hasHeader: boolean): Promise<Table> {
  const name = file.name.toLowerCase()
  if (name.endsWith('.xlsx')) return readXlsx(file, hasHeader)
  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    return toTable(parseCsv(decodeText(await file.arrayBuffer())), hasHeader)
  }
  if (name.endsWith('.xls')) {
    throw new Error('不支援舊版的 .xls，請用 Excel 另存為 .xlsx 或 CSV 後再匯入。')
  }
  throw new Error('請選擇 .csv 或 .xlsx 檔案。')
}

// Which column is the name, which is the student number, which is the unit. The
// presenter picks, but a list exported from a school system usually says so in
// its own header, and guessing right saves three taps.
const NAME_HINTS = ['姓名', '名字', '學生姓名', '學員姓名', 'name', 'student name', '中文姓名']
const STUDENT_NO_HINTS = ['學號', '學生證號', '座號', '編號', 'student id', 'student no', 'id']
const UNIT_HINTS = ['系所', '單位', '班級', '科系', '部門', 'class', 'department', 'unit', 'group']

function bestColumn(headers: string[], hints: string[]) {
  const lowered = headers.map((header) => header.trim().toLowerCase())
  for (const hint of hints) {
    const index = lowered.findIndex((header) => header === hint)
    if (index >= 0) return index
  }
  for (const hint of hints) {
    const index = lowered.findIndex((header) => header.includes(hint))
    if (index >= 0) return index
  }
  return -1
}

export function guessColumns(headers: string[]) {
  return {
    name: bestColumn(headers, NAME_HINTS),
    studentNo: bestColumn(headers, STUDENT_NO_HINTS),
    unit: bestColumn(headers, UNIT_HINTS),
  }
}
