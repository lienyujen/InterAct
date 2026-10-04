import { Camera } from 'lucide-react'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { Question } from '../types'

export function CameraPollResult({ question, locale = 'zh-TW' }: { question: Question; locale?: ParticipantLocale }) {
  const result = question.camera_result
  if (!result) return null
  const english = locale === 'en'
  const translated = english ? question.translations?.en : undefined
  const options = translated?.options?.length === question.options.length ? translated.options : question.options
  const maximum = Math.max(1, ...result.counts)
  return (
    <section className="panel camera-poll-result" aria-live="polite">
      <div className="camera-poll-result-heading"><Camera size={21} /><div><h2>{translated?.prompt_text || question.prompt_text || (english ? 'Whole-class camera response' : '全班相機作答')}</h2><p>{english ? `${result.totalDetected} people detected` : `共辨識 ${result.totalDetected} 人`}</p></div></div>
      <div className="camera-poll-bars">
        {options.map((option, index) => <div className="camera-poll-bar-row" key={index}>
          <strong>{option}</strong><div><span style={{ width: `${((result.counts[index] || 0) / maximum) * 100}%` }} /></div><b>{result.counts[index] || 0}</b>
        </div>)}
      </div>
      {result.unknownCount > 0 && <p className="muted">{english ? 'Unrecognized / no response' : '無法辨識／未作答'}：{result.unknownCount}</p>}
      {result.mode === 'poster' && <div className="camera-poll-paper-responses">{result.paperResponses?.map((text, index) => <article key={index}><strong>{english ? 'Paper' : '白紙'} {index + 1}</strong><p>{text || (english ? 'Unreadable' : '文字不清楚／無法讀取')}</p></article>)}</div>}
    </section>
  )
}
