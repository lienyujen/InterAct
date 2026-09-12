import { Plus, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { QuestionType, QuizRequestedType } from '../types'
import { CustomQuizFields } from './CustomQuizFields'
import { TimingRow } from './TimingRow'
import { ANSWER_PRESETS, PREPARE_PRESETS, canBeTimed, canPrepare } from '../lib/questionTiming'
import { quizSettingsFrom } from '../lib/customQuiz'
import type { CustomQuizSettings } from '../lib/customQuiz'

export type { CustomQuizSettings }

type Props = {
  error?: string
  open: boolean
  previewUrl: string | null
  onCancel: () => void
  // Reads the screenshot and proposes the items; nothing is dispatched by it.
  onGenerate: (direction: string) => Promise<GeneratedItems>
  onCreate: (request: DispatchRequest) => void
}

export type QuestionTiming = { prepareSeconds: number | null; answerSeconds: number | null }
export type GeneratedItems = { title: string; items?: string[]; pairs?: Array<{ left: string; right: string }> }
// What a dispatched ordering or matching question carries beyond its options:
// the selectable side, and the answer that must not travel on the question row.
export type QuestionKey = { choices: string[]; correctValues: string[] }

// Everything the dialog decided, in one piece.
export type DispatchRequest = {
  type: QuestionType
  options: string[]
  allowMultiple: boolean
  promptText: string
  timing: QuestionTiming
  key: QuestionKey
  // How many points one student may drop on a 圖上點選 image; null elsewhere.
  maxPins: number | null
  quizSettings?: CustomQuizSettings
}

const questionTypes: Array<{ type: QuestionType; label: string }> = [
  { type: 'send_screen', label: '派送畫面' },
  { type: 'hotspot', label: '圖上點選' },
  { type: 'custom_quiz', label: '自訂測驗' },
  { type: 'poll', label: '投票題' },
  { type: 'multiple_choice', label: '選擇題' },
  { type: 'true_false', label: '是非題' },
  { type: 'ordering', label: '排序題' },
  { type: 'matching', label: '配對題' },
  { type: 'file_upload', label: '上傳作答' },
  { type: 'short_answer', label: '問答題' },
  { type: 'oral_response', label: '口語表達' },
  { type: 'pronunciation', label: '朗讀發音' },
]

export function QuestionEditor({ error, open, previewUrl, onCancel, onCreate, onGenerate }: Props) {
  const [type, setType] = useState<QuestionType>('multiple_choice')
  const [options, setOptions] = useState(['A', 'B', 'C', 'D'])
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [quizCount, setQuizCount] = useState('auto')
  const [quizType, setQuizType] = useState<QuizRequestedType>('random')
  const [quizDirection, setQuizDirection] = useState('')
  const [prepareSeconds, setPrepareSeconds] = useState<number | null>(null)
  const [answerSeconds, setAnswerSeconds] = useState<number | null>(null)
  const [maxPins, setMaxPins] = useState(1)
  const [items, setItems] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  // An ordering question does not have to have a right answer: sometimes the
  // point is what the class thinks the order is.
  const [orderingHasAnswer, setOrderingHasAnswer] = useState(true)

  useEffect(() => {
    if (!open) return
    setType('multiple_choice')
    setOptions(['A', 'B', 'C', 'D'])
    setAllowMultiple(false)
    setPromptText('')
    setQuizCount('auto')
    setQuizType('random')
    setQuizDirection('')
    setPrepareSeconds(null)
    setAnswerSeconds(null)
    setMaxPins(1)
    setItems([])
    setGenerateError('')
    setOrderingHasAnswer(true)
  }, [open])

  const editableOptions = type === 'multiple_choice' || type === 'poll'
  const finalOptions = useMemo(() => {
    if (type === 'true_false') return ['是', '否']
    if (['short_answer', 'send_screen', 'pronunciation', 'oral_response', 'custom_quiz', 'file_upload', 'hotspot'].includes(type)) return []
    return options.map((option) => option.trim()).filter(Boolean)
  }, [options, type])

  // Shuffled so the class is not handed the answer in reading order; the key
  // keeps the order the presenter approved.
  function shuffled<T>(list: T[]) {
    const copy = [...list]
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1))
      ;[copy[index], copy[target]] = [copy[target], copy[index]]
    }
    return copy
  }

  function questionKey(): QuestionKey {
    if (type === 'ordering') {
      return { choices: [], correctValues: orderingHasAnswer ? items : [] }
    }
    // A matching question is written and dispatched in one step, never previewed:
    // the presenter's screen is on the projector while they dispatch, so showing
    // them the pairs first would show the class the answers.
    return { choices: [], correctValues: [] }
  }

  async function generate() {
    if (type !== 'ordering') return
    setGenerating(true)
    setGenerateError('')
    try {
      const generated = await onGenerate(promptText.trim())
      setItems(generated.items || [])
      if (!generated.items?.length) setGenerateError('AI 在這張截圖裡找不到有順序的內容，換一張或在題目欄說明要排什麼。')
    } catch (caught) {
      setGenerateError(caught instanceof Error ? caught.message : 'AI 出題失敗。')
    } finally {
      setGenerating(false)
    }
  }

  function moveItem(index: number, delta: number) {
    setItems((current) => {
      const target = index + delta
      if (target < 0 || target >= current.length) return current
      const next = [...current]
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <form
        className="modal question-modal"
        onSubmit={(event) => {
          event.preventDefault()
          if (type === 'custom_quiz') {
            const direction = quizDirection.trim()
            if (!direction) return
            onCreate({
              type,
              options: [],
              allowMultiple: false,
              promptText: direction,
              timing: { prepareSeconds: null, answerSeconds: null },
              key: { choices: [], correctValues: [] },
              maxPins: null,
              quizSettings: quizSettingsFrom(quizCount, quizType, direction),
            })
            return
          }
          const dispatchOptions = type === 'ordering' ? shuffled(items) : finalOptions
          onCreate({
            type,
            options: dispatchOptions,
            allowMultiple: editableOptions && allowMultiple,
            promptText: type === 'send_screen' ? '' : promptText.trim(),
            timing: {
              prepareSeconds: canPrepare(type) ? prepareSeconds : null,
              answerSeconds: canBeTimed(type) ? answerSeconds : null,
            },
            key: questionKey(),
            maxPins: type === 'hotspot' ? maxPins : null,
          })
        }}
      >
        <h2>截圖派題</h2>
        {previewUrl && <img alt="截圖預覽" className="capture-preview" src={previewUrl} />}
        {error && <p className="error">{error}</p>}
        <div className="type-grid">
          {questionTypes.map((item) => (
            <button
              className={`${type === item.type ? 'selected-type' : 'ghost-button'}${item.type === 'send_screen' ? ' send-screen-type' : ''}`}
              key={item.type}
              type="button"
              onClick={() => setType(item.type)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {editableOptions && (
          <div className="option-editor">
            <label className="multi-select-setting">
              <input
                checked={allowMultiple}
                type="checkbox"
                onChange={(event) => setAllowMultiple(event.target.checked)}
              />
              <span>允許多選</span>
            </label>
            <div className="panel-heading">
              <h2>選項</h2>
              <button className="ghost-button icon-button" type="button" onClick={() => setOptions((current) => [...current, String.fromCharCode(65 + current.length)])}>
                <Plus size={16} />
              </button>
            </div>
            {options.map((option, index) => (
              <div className="option-edit-row" key={index}>
                <input
                  aria-label={`選項 ${index + 1}`}
                  value={option}
                  onChange={(event) => {
                    const next = [...options]
                    next[index] = event.target.value
                    setOptions(next)
                  }}
                />
                <button
                  className="ghost-button icon-button"
                  disabled={options.length <= 2}
                  type="button"
                  onClick={() => setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index))}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
        {type === 'ordering' && (
          <div className="generated-items">
            <div className="generated-items-heading">
              <button className="ghost-button" disabled={generating} type="button" onClick={() => void generate()}>
                <Sparkles size={16} />
                {generating ? 'AI 讀取截圖中...' : items.length ? '重新產生' : 'AI 產生題目'}
              </button>
              {items.length > 0 && (
                <label className="multi-select-setting">
                  <input
                    checked={orderingHasAnswer}
                    type="checkbox"
                    onChange={(event) => setOrderingHasAnswer(event.target.checked)}
                  />
                  <span>有標準答案</span>
                </label>
              )}
            </div>
            {generateError && <p className="error">{generateError}</p>}
            {items.length > 0 && (
              <>
                <p className="muted question-type-hint">
                  {orderingHasAnswer
                    ? '下面就是正確順序，用箭頭調整。學生看到的會是打散的。'
                    : '沒有標準答案，學生排完之後你會看到全班把每個項目排在第幾位的比率。'}
                </p>
                <ol className="generated-item-list">
                  {items.map((item, index) => (
                    <li key={`${index}-${item}`}>
                      <span>{item}</span>
                      <span className="generated-item-actions">
                        <button className="ghost-button icon-button" disabled={!index} type="button" onClick={() => moveItem(index, -1)}>↑</button>
                        <button className="ghost-button icon-button" disabled={index === items.length - 1} type="button" onClick={() => moveItem(index, 1)}>↓</button>
                        <button className="ghost-button icon-button" type="button" onClick={() => setItems((current) => current.filter((_, at) => at !== index))}><Trash2 size={15} /></button>
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
          </div>
        )}
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
        {type === 'file_upload' && (
          <p className="muted question-type-hint">
            學生端會看到這張截圖和上傳按鈕，手機、平板可以直接拍照上傳。停止作答後可逐份批改。
          </p>
        )}
        {type === 'custom_quiz' && (
          <CustomQuizFields
            count={quizCount}
            direction={quizDirection}
            quizType={quizType}
            onCountChange={setQuizCount}
            onDirectionChange={setQuizDirection}
            onTypeChange={setQuizType}
          />
        )}
        {type !== 'send_screen' && type !== 'custom_quiz' && (
          <label className="question-prompt-field">
            {type === 'pronunciation' ? '指定朗讀內容（選填）'
              : type === 'file_upload' ? '作答說明（選填）'
              : type === 'matching' ? '出題方向（選填）'
              : '題目（選填）'}
            <input
              value={promptText}
              placeholder={type === 'pronunciation'
                ? '未輸入則以 AI 判讀截圖中的朗讀內容'
                : type === 'file_upload'
                  ? '例如：請把計算過程寫在紙上拍照上傳'
                  : type === 'matching'
                    // Matching is generated on dispatch with nothing shown first, so this
                    // is the only steer the presenter gets — say so.
                    ? '例如：找出 5 個難的中文詞和英文詞做成配對題'
                    : '未輸入則以AI判讀題目'}
              onChange={(event) => setPromptText(event.target.value)}
            />
          </label>
        )}
        {canBeTimed(type) && (
          <div className="question-timing">
            {canPrepare(type) && (
              <TimingRow
                label="準備時間"
                offLabel="不準備"
                presets={PREPARE_PRESETS}
                value={prepareSeconds}
                onChange={setPrepareSeconds}
              />
            )}
            <TimingRow
              label="作答時間"
              offLabel="不限時"
              presets={ANSWER_PRESETS}
              value={answerSeconds}
              onChange={setAnswerSeconds}
            />
          </div>
        )}
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            <X size={17} />取消
          </button>
          <button
            disabled={(type === 'custom_quiz' && !quizDirection.trim())
              || (type === 'ordering' && items.length < 2)
              }
            type="submit"
          >
            {type === 'custom_quiz' ? <Sparkles size={17} /> : <Send size={17} />}
            {type === 'custom_quiz' ? 'AI 出題並派送' : '派送'}
          </button>
        </div>
      </form>
    </div>
  )
}
