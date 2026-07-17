import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { QuestionType } from '../types'

type Props = {
  open: boolean
  previewUrl: string | null
  onCancel: () => void
  onCreate: (type: QuestionType, options: string[], allowMultiple: boolean, promptText: string) => void
}

const questionTypes: Array<{ type: QuestionType; label: string }> = [
  { type: 'send_screen', label: '派送畫面' },
  { type: 'poll', label: '投票題' },
  { type: 'multiple_choice', label: '選擇題' },
  { type: 'true_false', label: '是非題' },
  { type: 'short_answer', label: '問答題' },
]

export function QuestionEditor({ open, previewUrl, onCancel, onCreate }: Props) {
  const [type, setType] = useState<QuestionType>('multiple_choice')
  const [options, setOptions] = useState(['A', 'B', 'C', 'D'])
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [promptText, setPromptText] = useState('')

  useEffect(() => {
    if (!open) return
    setType('multiple_choice')
    setOptions(['A', 'B', 'C', 'D'])
    setAllowMultiple(false)
    setPromptText('')
  }, [open])

  const editableOptions = type === 'multiple_choice' || type === 'poll'
  const finalOptions = useMemo(() => {
    if (type === 'true_false') return ['是', '否']
    if (type === 'short_answer' || type === 'send_screen') return []
    return options.map((option) => option.trim()).filter(Boolean)
  }, [options, type])

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <form
        className="modal question-modal"
        onSubmit={(event) => {
          event.preventDefault()
          onCreate(type, finalOptions, editableOptions && allowMultiple, type === 'send_screen' ? '' : promptText.trim())
        }}
      >
        <h2>截圖派題</h2>
        {previewUrl && <img alt="截圖預覽" className="capture-preview" src={previewUrl} />}
        <div className="type-grid">
          {questionTypes.map((item) => (
            <button
              className={type === item.type ? 'selected-type' : 'ghost-button'}
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
        {type !== 'send_screen' && (
          <label className="question-prompt-field">
            題目（選填）
            <input
              value={promptText}
              placeholder="未輸入則以AI判讀題目"
              onChange={(event) => setPromptText(event.target.value)}
            />
          </label>
        )}
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button type="submit">派送</button>
        </div>
      </form>
    </div>
  )
}
