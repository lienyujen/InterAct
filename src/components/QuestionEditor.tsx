import { Plus, Send, Sparkles, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { QuestionType, QuizRequestedType } from '../types'
import { CustomQuizFields } from './CustomQuizFields'
import { quizSettingsFrom } from '../lib/customQuiz'
import type { CustomQuizSettings } from '../lib/customQuiz'

export type { CustomQuizSettings }

type Props = {
  error?: string
  open: boolean
  previewUrl: string | null
  onCancel: () => void
  onCreate: (type: QuestionType, options: string[], allowMultiple: boolean, promptText: string, quizSettings?: CustomQuizSettings) => void
}

const questionTypes: Array<{ type: QuestionType; label: string }> = [
  { type: 'send_screen', label: '派送畫面' },
  { type: 'custom_quiz', label: '自訂測驗' },
  { type: 'poll', label: '投票題' },
  { type: 'multiple_choice', label: '選擇題' },
  { type: 'file_upload', label: '上傳作答' },
  { type: 'short_answer', label: '問答題' },
  { type: 'oral_response', label: '口語表達' },
  { type: 'pronunciation', label: '朗讀發音' },
]

export function QuestionEditor({ error, open, previewUrl, onCancel, onCreate }: Props) {
  const [type, setType] = useState<QuestionType>('multiple_choice')
  const [options, setOptions] = useState(['A', 'B', 'C', 'D'])
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [promptText, setPromptText] = useState('')
  const [quizCount, setQuizCount] = useState('auto')
  const [quizType, setQuizType] = useState<QuizRequestedType>('random')
  const [quizDirection, setQuizDirection] = useState('')

  useEffect(() => {
    if (!open) return
    setType('multiple_choice')
    setOptions(['A', 'B', 'C', 'D'])
    setAllowMultiple(false)
    setPromptText('')
    setQuizCount('auto')
    setQuizType('random')
    setQuizDirection('')
  }, [open])

  const editableOptions = type === 'multiple_choice' || type === 'poll'
  const finalOptions = useMemo(() => {
    if (['short_answer', 'send_screen', 'pronunciation', 'oral_response', 'custom_quiz', 'file_upload'].includes(type)) return []
    return options.map((option) => option.trim()).filter(Boolean)
  }, [options, type])

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
            onCreate(type, [], false, direction, quizSettingsFrom(quizCount, quizType, direction))
            return
          }
          onCreate(type, finalOptions, editableOptions && allowMultiple, type === 'send_screen' ? '' : promptText.trim())
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
            {type === 'pronunciation' ? '指定朗讀內容（選填）' : type === 'file_upload' ? '作答說明（選填）' : '題目（選填）'}
            <input
              value={promptText}
              placeholder={type === 'pronunciation'
                ? '未輸入則以 AI 判讀截圖中的朗讀內容'
                : type === 'file_upload'
                  ? '例如：請把計算過程寫在紙上拍照上傳'
                  : '未輸入則以AI判讀題目'}
              onChange={(event) => setPromptText(event.target.value)}
            />
          </label>
        )}
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            <X size={17} />取消
          </button>
          <button disabled={type === 'custom_quiz' && !quizDirection.trim()} type="submit">
            {type === 'custom_quiz' ? <Sparkles size={17} /> : <Send size={17} />}
            {type === 'custom_quiz' ? 'AI 出題並派送' : '派送'}
          </button>
        </div>
      </form>
    </div>
  )
}
