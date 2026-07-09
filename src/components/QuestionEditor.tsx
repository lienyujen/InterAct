import { useState } from 'react'

type Props = {
  open: boolean
  onCancel: () => void
  onCreate: (title: string, options: string[]) => void
}

export function QuestionEditor({ open, onCancel, onCreate }: Props) {
  const [title, setTitle] = useState('')
  const [options, setOptions] = useState(['A', 'B', 'C', 'D'])

  if (!open) return null

  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(event) => {
          event.preventDefault()
          onCreate(
            title.trim() || '請選出正確答案',
            options.map((option) => option.trim()).filter(Boolean),
          )
          setTitle('')
        }}
      >
        <h2>建立選擇題</h2>
        <label>
          題目
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：這張投影片的重點是什麼？" />
        </label>
        {options.map((option, index) => (
          <label key={index}>
            選項 {index + 1}
            <input
              value={option}
              onChange={(event) => {
                const next = [...options]
                next[index] = event.target.value
                setOptions(next)
              }}
            />
          </label>
        ))}
        <div className="modal-actions">
          <button className="ghost-button" type="button" onClick={onCancel}>
            取消
          </button>
          <button type="submit">送出題目</button>
        </div>
      </form>
    </div>
  )
}
