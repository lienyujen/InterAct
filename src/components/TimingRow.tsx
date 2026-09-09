import { formatSeconds } from '../lib/questionTiming'

type Props = {
  label: string
  // "Off" reads differently for each clock and the difference matters to the
  // teacher scanning the row: a spoken answer's off is 不準備, a written one's
  // is 不限時.
  offLabel: string
  presets: Array<number | null>
  value: number | null
  // What a preset number means. It defaults to seconds because that is what
  // most of these rows are, but 圖上點選 counts taps — and a row that silently
  // renders "3 秒" for "3 個" is worse than no row at all.
  formatValue?: (value: number) => string
  onChange: (value: number | null) => void
}

// Chips rather than a number input: this gets set mid-class, and a row of taps
// beats typing into a spinner while thirty students wait.
export function TimingRow({ label, offLabel, presets, value, formatValue = formatSeconds, onChange }: Props) {
  return (
    <div className="timing-row">
      <span className="timing-row-label">{label}</span>
      <div className="timing-chips">
        {presets.map((preset) => (
          <button
            aria-pressed={value === preset}
            className={`timing-chip${value === preset ? ' is-selected' : ''}`}
            key={preset ?? 'off'}
            type="button"
            onClick={() => onChange(preset)}
          >
            {preset === null ? offLabel : formatValue(preset)}
          </button>
        ))}
      </div>
    </div>
  )
}
