import { formatSeconds } from '../lib/questionTiming'

type Props = {
  label: string
  // "Off" reads differently for each clock and the difference matters to the
  // teacher scanning the row: a spoken answer's off is 不準備, a written one's
  // is 不限時.
  offLabel: string
  presets: Array<number | null>
  value: number | null
  onChange: (value: number | null) => void
}

// Chips rather than a number input: this gets set mid-class, and a row of taps
// beats typing into a spinner while thirty students wait.
export function TimingRow({ label, offLabel, presets, value, onChange }: Props) {
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
            {preset === null ? offLabel : formatSeconds(preset)}
          </button>
        ))}
      </div>
    </div>
  )
}
