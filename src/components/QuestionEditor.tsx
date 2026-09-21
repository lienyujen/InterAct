import { Maximize2, Plus, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { BoardPostKind, QuestionType, QuizRequestedType } from '../types'
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
  // 排序題 only, and only when the presenter asked for the screenshot to be cut
  // up: how many pieces to ask the AI for. Null means an ordinary written one.
  sliceCount: number | null
  // Whether a sliced ordering is marked against the original order. Off by
  // default: most of the time the point is what the class makes of the pieces.
  sliceHasAnswer: boolean
  // 排序題 only: rebuild one sentence rather than rank separate items.
  sentenceMode: boolean
  // 排序題 / 配對題 only: also show the class the capture. Off by default — for a
  // sliced ordering the uncut original is the answer.
  shareScreenshot: boolean
  maxPins: number | null
  // 討論板: which kinds of card the class may put up. Empty means the screen
  // was dispatched with nothing to answer, and the type goes out as
  // 'send_screen' — the board is this same dispatch with replies switched on.
  boardFormats: BoardPostKind[]
  // How many cards one student may put up; null is ∞.
  boardMaxPosts: number | null
  // Whether the class starts out unable to see each other's cards.
  boardSelfPaced: boolean
  quizSettings?: CustomQuizSettings
}

const boardFormatChoices: Array<{ kind: BoardPostKind; label: string; hint: string }> = [
  { kind: 'text', label: '文字', hint: '打字回應' },
  { kind: 'link', label: '連結', hint: '貼網址' },
  { kind: 'image', label: '圖片', hint: '上傳圖片，行動裝置自動開啟相機' },
  { kind: 'file', label: '檔案', hint: '上傳檔案' },
  { kind: 'audio', label: '錄音', hint: '直接錄' },
  { kind: 'drawing', label: '電繪', hint: '在截圖上畫或重畫' },
]

const questionTypes: Array<{ type: QuestionType; label: string }> = [
  { type: 'send_screen', label: '派題討論' },
  { type: 'hotspot', label: '圖上點選' },
  { type: 'custom_quiz', label: '自訂測驗' },
  { type: 'poll', label: '投票題' },
  { type: 'multiple_choice', label: '選擇題' },
  { type: 'drawing', label: '電寫題' },
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
  // Cutting the screenshot up instead of writing the items out.
  const [sliceImage, setSliceImage] = useState(false)
  const [sliceCount, setSliceCount] = useState(4)
  const [sentenceMode, setSentenceMode] = useState(false)
  const [shareScreenshot, setShareScreenshot] = useState(false)
  const [items, setItems] = useState<string[]>([])
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState('')
  // An ordering question does not have to have a right answer: sometimes the
  // point is what the class thinks the order is.
  const [orderingHasAnswer, setOrderingHasAnswer] = useState(true)
  // 派送畫面 becomes a 討論板 the moment one of these is ticked. Nothing ticked
  // is the plain dispatch it has always been, so the presenter never has to
  // choose between two things that look the same on the way in.
  const [boardFormats, setBoardFormats] = useState<BoardPostKind[]>([])
  const [boardMaxPosts, setBoardMaxPosts] = useState<number | null>(1)
  // Its own flag rather than the one 排序題 uses, because the sensible default
  // is the other way round: a board was captured from something worth
  // discussing, so the picture goes with it unless the presenter says not to.
  const [boardShareScreenshot, setBoardShareScreenshot] = useState(true)
  // Off by default: a wall the class cannot see is not a wall. Ticking it is
  // the presenter asking for everyone to think alone first, and they can turn
  // it on and off from the board itself once the class is going.
  const [boardSelfPaced, setBoardSelfPaced] = useState(false)
  // A screen capture shown at the width of this dialog is around a sixth of
  // its real size, which is legible for a diagram and not for a page of text.
  // This is the capture at 1:1, pannable, for when it has to be read.
  const [previewZoomed, setPreviewZoomed] = useState(false)
  const isBoard = type === 'send_screen' && boardFormats.length > 0
  const zoomScrollRef = useRef<HTMLDivElement | null>(null)

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
    setSliceImage(false)
    setSliceCount(4)
    setSentenceMode(false)
    setShareScreenshot(false)
    setBoardFormats([])
    setBoardMaxPosts(1)
    setBoardShareScreenshot(true)
    setBoardSelfPaced(false)
    setPreviewZoomed(false)
  }, [open])

  const editableOptions = type === 'multiple_choice' || type === 'poll'
  const finalOptions = useMemo(() => {
    if (['short_answer', 'send_screen', 'pronunciation', 'oral_response', 'custom_quiz', 'file_upload', 'drawing', 'hotspot'].includes(type)) return []
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

  // Escape closes the zoom rather than the whole dialog: the presenter who
  // opened the capture to read it has not decided to abandon the question.
  useEffect(() => {
    if (!previewZoomed) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setPreviewZoomed(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [previewZoomed])

  // Drag to pan. Scrollbars alone are a poor way to read across a capture
  // twice the width of the window, and the cursor already promises this.
  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    const scroller = zoomScrollRef.current
    if (!scroller || event.button !== 0) return
    const from = { x: event.clientX, y: event.clientY, left: scroller.scrollLeft, top: scroller.scrollTop }
    const onMove = (move: PointerEvent) => {
      scroller.scrollLeft = from.left - (move.clientX - from.x)
      scroller.scrollTop = from.top - (move.clientY - from.y)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      scroller.classList.remove('is-panning')
    }
    scroller.classList.add('is-panning')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
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
              sliceCount: null,
              sliceHasAnswer: false,
              sentenceMode: false,
              shareScreenshot: false,
              boardFormats: [],
              boardMaxPosts: null,
              boardSelfPaced: false,
              quizSettings: quizSettingsFrom(quizCount, quizType, direction),
            })
            return
          }
          const dispatchOptions = type === 'ordering' ? shuffled(items) : finalOptions
          onCreate({
            type: isBoard ? 'board' : type,
            options: dispatchOptions,
            allowMultiple: editableOptions && allowMultiple,
            // A dispatched screen has nothing to say; a board is a topic, and
            // the topic is the only thing on the card for a board sent without
            // the capture.
            promptText: type === 'send_screen' && !isBoard ? '' : promptText.trim(),
            timing: {
              prepareSeconds: canPrepare(type) ? prepareSeconds : null,
              answerSeconds: canBeTimed(type) ? answerSeconds : null,
            },
            key: questionKey(),
            maxPins: type === 'hotspot' ? maxPins : null,
            sliceCount: type === 'ordering' && sliceImage ? sliceCount : null,
            sliceHasAnswer: orderingHasAnswer,
            sentenceMode: type === 'ordering' && !sliceImage && sentenceMode,
            // A board has its own answer to this, and the opposite default:
            // 排序題 hides the capture because the uncut original is the
            // answer, while a board has just been captured from something the
            // presenter wants to talk about.
            shareScreenshot: isBoard ? boardShareScreenshot : shareScreenshot,
            boardFormats: isBoard ? boardFormats : [],
            boardMaxPosts: isBoard ? boardMaxPosts : null,
            boardSelfPaced: isBoard && boardSelfPaced,
          })
        }}
      >
        <h2>截圖派題</h2>
        {previewUrl && (
          <button
            aria-label="放大檢視截圖"
            className="capture-preview-button"
            title="放大檢視截圖（原尺寸）"
            type="button"
            onClick={() => setPreviewZoomed(true)}
          >
            <img alt="截圖預覽" className="capture-preview" src={previewUrl} />
            <span className="capture-preview-zoom"><Maximize2 size={15} />放大</span>
          </button>
        )}
        {previewUrl && previewZoomed && (
          // Inside the dialog rather than in a window of its own: the capture
          // has not been uploaded yet, so it exists only here.
          <div
            className="capture-zoom"
            role="dialog"
            aria-label="截圖原尺寸"
            onClick={() => setPreviewZoomed(false)}
          >
            <button aria-label="關閉" className="capture-zoom-close" type="button" onClick={() => setPreviewZoomed(false)}>
              <X size={20} />
            </button>
            <div
              className="capture-zoom-scroll"
              ref={zoomScrollRef}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={startPan}
            >
              {/* Dragging an image is a browser drag-and-drop by default, which
                  cancels the pan the moment it starts. */}
              <img alt="截圖原尺寸" draggable={false} src={previewUrl} />
            </div>
          </div>
        )}
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
        {(type === 'ordering' || type === 'matching') && (
          <label className="multi-select-setting" title="預設不送。排序題若是切圖出的題，原圖就是答案">
            <input
              checked={shareScreenshot}
              type="checkbox"
              onChange={(event) => setShareScreenshot(event.target.checked)}
            />
            <span>同時把截圖給學生看</span>
          </label>
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
        {type === 'drawing' && (
          <p className="muted question-type-hint">
            學生會拿到這張截圖當底圖，直接在上面寫解題過程或作答，也可以勾掉底圖用白紙自己畫。
            收回來的是一人一張圖，可以逐張放大看，也可以一次交給 AI 批改全班。
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
        {type === 'send_screen' && (
          <div className="board-setup">
            <label className="question-prompt-field">
              題目（選填）
              <input
                value={promptText}
                placeholder="例如：看完這段，你想到哪一個教學現場的例子？"
                onChange={(event) => setPromptText(event.target.value)}
              />
            </label>
            <label className="multi-select-setting">
              <input
                checked={boardShareScreenshot}
                type="checkbox"
                onChange={(event) => setBoardShareScreenshot(event.target.checked)}
              />
              附上截圖
            </label>
            <p className="muted question-type-hint">
              {boardShareScreenshot
                ? (promptText.trim() ? '學生會看到這張截圖和你的題目。' : '學生只會看到這張截圖。')
                : (promptText.trim() ? '不送出截圖，學生只讀到你的題目。' : '沒有截圖也沒有題目，學生會看到一張空白的卡。')}
            </p>

            {/* Ticking any of these turns the dispatch into a board. Nothing
                ticked is the plain 派送畫面 it has always been, which is why
                there is no separate type to choose on the way in. */}
            <fieldset className="board-formats">
              <legend>開放答題方式（不選就是單純派送）</legend>
              <div className="board-format-grid">
                {boardFormatChoices.map((choice) => {
                  const on = boardFormats.includes(choice.kind)
                  return (
                    <button
                      aria-pressed={on}
                      className={`board-format-chip${on ? ' is-selected' : ''}`}
                      key={choice.kind}
                      type="button"
                      onClick={() => setBoardFormats((current) => (
                        current.includes(choice.kind)
                          ? current.filter((kind) => kind !== choice.kind)
                          : [...current, choice.kind]
                      ))}
                    >
                      <strong>{choice.label}</strong>
                      <span>{choice.hint}</span>
                    </button>
                  )
                })}
              </div>
            </fieldset>

            {isBoard && (
              <div className="question-timing">
                <TimingRow
                  formatValue={(value) => `${value} 則`}
                  label="每人可貼"
                  offLabel="∞"
                  presets={[1, 2, 3, 5, null]}
                  value={boardMaxPosts}
                  onChange={setBoardMaxPosts}
                />
              </div>
            )}
            {isBoard && (
              <label className="multi-select-setting">
                <input
                  checked={boardSelfPaced}
                  type="checkbox"
                  onChange={(event) => setBoardSelfPaced(event.target.checked)}
                />
                自行作答（先看不到別人的，你再決定何時開放）
              </label>
            )}
            {isBoard && (
              <p className="muted question-type-hint">
                {boardSelfPaced
                  ? '學生只看得到自己貼的，你在討論板上按一下就整面翻開。'
                  : '全班互相看得到。隨時可以改成自行作答。'}
                討論板會一直開著，你可以繼續派別的題目，學生隨時回來加。
              </p>
            )}
          </div>
        )}
        {type !== 'send_screen' && type !== 'custom_quiz' && (
          <label className="question-prompt-field">
            {type === 'pronunciation' ? '指定朗讀內容（選填）'
              : type === 'file_upload' ? '作答說明（選填）'
              : type === 'drawing' ? '題目（選填，寫了 AI 更知道怎麼改）'
              : type === 'matching' ? '出題方向（選填）'
              : '題目（選填）'}
            <input
              value={promptText}
              placeholder={type === 'pronunciation'
                ? '未輸入則以 AI 判讀截圖中的朗讀內容'
                : type === 'file_upload'
                  ? '例如：請把計算過程寫在紙上拍照上傳'
                : type === 'drawing'
                  ? '例如：把因式分解的每一步寫出來（留空則由 AI 判讀截圖上的題目）'
                  : type === 'matching'
                    // Matching is generated on dispatch with nothing shown first, so this
                    // is the only steer the presenter gets — say so.
                    ? '例如：找出 5 個難的中文詞和英文詞做成配對題'
                    : type === 'ordering'
                      // It sits above 產生題目 because the generator reads it:
                      // write the steer first, then press the button.
                      ? '例如：把實驗步驟依先後排序（留空則由 AI 判讀）'
                      : '未輸入則以AI判讀題目'}
              onChange={(event) => setPromptText(event.target.value)}
            />
          </label>
        )}
        {type === 'ordering' && (
          <div className="generated-items">
            <label className="multi-select-setting">
              <input
                checked={sliceImage}
                type="checkbox"
                onChange={(event) => { setSliceImage(event.target.checked); setOrderingHasAnswer(!event.target.checked) }}
              />
              <span>用截圖分割出題</span>
            </label>
            {sliceImage ? (
              <>
                <label className="multi-select-setting">
                  <input
                    checked={orderingHasAnswer}
                    type="checkbox"
                    onChange={(event) => setOrderingHasAnswer(event.target.checked)}
                  />
                  <span>有標準答案</span>
                </label>
                <TimingRow
                  formatValue={(value) => `${value} 塊`}
                  label="切成"
                  offLabel="4 塊"
                  presets={[3, 4, 5, 6]}
                  value={sliceCount}
                  onChange={(value) => setSliceCount(value ?? 4)}
                />
                <p className="muted question-type-hint">
                  {orderingHasAnswer
                    ? '派送時 AI 會把截圖切成上面的塊數、打散給學生排，正確順序就是原圖的順序，會自動批改。'
                    : '派送時 AI 會把截圖切成上面的塊數、打散給學生排。沒有標準答案，你會看到全班的平均排序結果。'}
                  {orderingHasAnswer && ' 截圖裡若本來就有編號，切開後編號會跟著過去，等於送分。'}
                </p>
              </>
            ) : (
            <>
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
              {items.length > 0 && (
                <label className="multi-select-setting" title="勾選後學生會看到橫式的詞塊與句子區，適合語句排序；不勾就是一般的項目排序">
                  <input
                    checked={sentenceMode}
                    type="checkbox"
                    onChange={(event) => setSentenceMode(event.target.checked)}
                  />
                  <span>語句排序</span>
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
            </>
            )}
          </div>
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
              || (type === 'ordering' && !sliceImage && items.length < 2)
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
