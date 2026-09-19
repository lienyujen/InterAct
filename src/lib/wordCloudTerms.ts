// Domain vocabulary for the word cloud.
//
// Intl.Segmenter carries ICU's general-purpose Chinese dictionary, which has
// never heard of the words a subject is actually about. Measured against this
// list, it splits 47 of 56 terms: 人工智慧 becomes 人工 + 智慧, 華語教學 becomes
// 華語 + 教學, 專案管理 becomes 專案 + 管理. The cloud then shows the halves —
// exactly the words a teacher is least interested in — and never shows the term.
//
// So the segmenter is left alone and its output is stitched back together: any
// run of adjacent segments that spells a known term is rejoined into one word.
//
// Entries that ICU already gets right (語言學, 演算法, 鷹架) are harmless here
// but inert: the merge only ever fires across two or more segments, so a term
// that was never split has nothing to rejoin. They are kept because this list
// doubles as a record of the vocabulary, and a maintainer adding a term should
// not have to know which side of that line it falls on.

const AI = [
  '人工智慧', '機器學習', '深度學習', '生成式', '生成式人工智慧', '大型語言模型', '語言模型',
  '自然語言處理', '神經網路', '提示詞', '提示工程', '演算法', '資料科學', '資料探勘',
  '語音辨識', '語音合成', '電腦視覺', '影像辨識', '訓練資料', '微調', '幻覺',
  '智慧型手機', '數位轉型', '自動化', '機器翻譯', '智慧教室',
]

const LINGUISTICS = [
  '語言學', '社會語言學', '心理語言學', '應用語言學', '認知語言學', '對比語言學',
  '語音學', '音韻學', '語意學', '語用學', '構詞學', '句法學', '詞彙學', '語法',
  '第二語言習得', '語言習得', '母語', '外語', '目標語', '中介語', '偏誤分析',
  '語料庫', '語碼轉換', '語言遷移', '可理解輸入', '輸出假說',
]

const CHINESE_TEACHING = [
  '華語教學', '華語文', '對外漢語', '華語文教學', '正體字', '簡體字', '繁簡轉換',
  '聲調', '拼音', '注音', '漢字教學', '筆順', '部件', '識字量',
  '聽說讀寫', '口語表達', '閱讀理解', '寫作教學', '文化教學', '教材編寫',
  '分級教材', '語言能力指標', '華測會', '歐洲共同語文參考架構',
]

const PEDAGOGY = [
  '教學設計', '教學法', '教學策略', '教學目標', '課程設計', '課程地圖', '學習目標',
  '形成性評量', '總結性評量', '診斷性評量', '實作評量', '評量規準', '學習成效',
  '翻轉教室', '差異化教學', '合作學習', '探究式學習', '專題式學習', '問題導向學習',
  '鷹架', '後設認知', '學習動機', '學習歷程', '自主學習', '同儕互評',
  '數位教材', '數位學習', '混成教學', '同步教學', '非同步教學', '遠距教學',
  '課堂互動', '課堂經營', '師生互動', '學習單', '教學回饋',
]

const MANAGEMENT = [
  '企業管理', '企管', '管理', '人力資源', '組織行為', '組織文化', '策略管理',
  '行銷管理', '專案管理', '知識管理', '變革管理', '危機管理', '品質管理',
  '績效評估', '績效管理', '領導力', '領導風格', '團隊合作', '溝通技巧',
  '決策分析', '商業模式', '供應鏈', '顧客關係管理', '創新管理',
]

export const BUILT_IN_TERMS = [...AI, ...LINGUISTICS, ...CHINESE_TEACHING, ...PEDAGOGY, ...MANAGEMENT]

const CUSTOM_KEY = 'interact:word-cloud-terms'

// The presenter's own words, kept on this computer beside the class lists. A
// subject always has vocabulary no general list anticipated, and the moment to
// add it is when the cloud gets it wrong in front of the class.
export function readCustomTerms(): string[] {
  try {
    const raw = window.localStorage.getItem(CUSTOM_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((term): term is string => typeof term === 'string') : []
  } catch {
    return []
  }
}

export function writeCustomTerms(terms: string[]) {
  const cleaned = [...new Set(terms.map((term) => term.trim()).filter(Boolean))]
  window.localStorage.setItem(CUSTOM_KEY, JSON.stringify(cleaned))
  return cleaned
}

// Newlines, commas of both widths, and the enumeration comma — the same set the
// class list accepts, because a term list arrives pasted the same way.
export function parseTermInput(text: string) {
  return text.split(/[\n\r,、，;；\t]+/).map((term) => term.trim()).filter(Boolean)
}

export type TermIndex = {
  terms: Set<string>
  // How many segments the longest term can span, so the matcher knows how far
  // ahead to look instead of trying every possible run.
  maxSpan: number
}

export function buildTermIndex(extra: string[] = []): TermIndex {
  const terms = new Set<string>()
  let longest = 0
  for (const term of [...BUILT_IN_TERMS, ...extra]) {
    const cleaned = term.trim()
    if (!cleaned) continue
    terms.add(cleaned)
    // One CJK character is never more than one segment, so its length is a safe
    // upper bound on how many segments it could have been broken into.
    longest = Math.max(longest, [...cleaned].length)
  }
  return { terms, maxSpan: Math.max(2, Math.min(longest, 12)) }
}

// Longest match wins at each position, so 生成式人工智慧 is one word rather than
// 生成式 followed by 人工智慧.
export function mergeTerms(words: string[], index: TermIndex) {
  const merged: string[] = []
  for (let position = 0; position < words.length;) {
    let matched = ''
    let span = 0
    const reach = Math.min(index.maxSpan, words.length - position)
    for (let length = reach; length >= 2; length -= 1) {
      const joined = words.slice(position, position + length).join('')
      if (index.terms.has(joined)) {
        matched = joined
        span = length
        break
      }
    }
    if (matched) {
      merged.push(matched)
      position += span
    } else {
      merged.push(words[position])
      position += 1
    }
  }
  return merged
}
