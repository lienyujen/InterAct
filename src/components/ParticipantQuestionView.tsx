import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Send } from 'lucide-react'
import { AudioRecorder } from './AudioRecorder'
import { participantText } from '../lib/participantI18n'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { Answer, AudioResponse, Question } from '../types'

type Props = {
  question: Question | null
  answer: Answer | null
  audioBusy: boolean
  audioResponse: AudioResponse | null
  onSubmit: (value: string | string[]) => void
  onSubmitAudio: (file: File, durationMs: number) => Promise<void>
  locale?: ParticipantLocale
}

export function ParticipantQuestionView({ question, answer, audioBusy, audioResponse, onSubmit, onSubmitAudio, locale = 'zh-TW' }: Props) {
  const [textAnswer, setTextAnswer] = useState('')
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])

  useEffect(() => {
    setTextAnswer('')
    setSelectedOptions([])
  }, [question?.id])

  // file_upload has its own panel further up the page, carrying the same prompt
  // and the screenshot; rendering here as well would print the question twice.
  if (!question || ['send_screen', 'custom_quiz', 'file_upload'].includes(question.type)) return null
  const isAudioQuestion = question.type === 'pronunciation' || question.type === 'oral_response'
  const translation = locale === 'en' ? question.translations?.en : undefined
  const englishTypeTitles: Partial<Record<Question['type'], string>> = {
    poll: 'Poll',
    multiple_choice: 'Multiple-choice question',
    true_false: 'True or false',
    short_answer: 'Short-answer question',
    pronunciation: 'Pronunciation practice',
    oral_response: 'Speaking response',
  }
  const fallbackTitle = locale === 'en' ? englishTypeTitles[question.type] : question.title
  const prompt = translation?.prompt_text || translation?.title || question.prompt_text || fallbackTitle || participantText(locale, 'interactiveQuestion')
  const translatedOptions = translation?.options?.length === question.options.length ? translation.options : question.options
  const displayAnswer = (value: string) => {
    const index = question.options.indexOf(value)
    return index >= 0 ? translatedOptions[index] : value
  }

  function submitShortAnswer(event: FormEvent) {
    event.preventDefault()
    const value = textAnswer.trim()
    if (value) onSubmit(value)
  }

  return (
    <section className="panel participant-question">
      <h2>{prompt}</h2>
      {question.status !== 'active' && <p className="muted">{participantText(locale, 'questionEnded')}</p>}
      {isAudioQuestion && (
        <AudioRecorder busy={audioBusy} locale={locale} question={question} response={audioResponse} onSubmit={onSubmitAudio} />
      )}
      {answer && !isAudioQuestion && <p className="success">{participantText(locale, 'submittedAnswer')}{answer.answer_values?.map(displayAnswer).join(locale === 'en' ? ', ' : '、') || (answer.answer_value ? displayAnswer(answer.answer_value) : answer.answer_text)}</p>}
      {!answer && question.status === 'active' && question.type === 'short_answer' && (
        <form className="short-answer-form" onSubmit={submitShortAnswer}>
          <textarea
            maxLength={1000}
            value={textAnswer}
            onChange={(event) => setTextAnswer(event.target.value)}
            placeholder={participantText(locale, 'answerPlaceholder')}
          />
          <button type="submit"><Send size={18} />{participantText(locale, 'submitAnswer')}</button>
        </form>
      )}
      {!answer && !isAudioQuestion && question.status === 'active' && question.type !== 'short_answer' && question.allow_multiple && (
        <form
          className="multi-choice-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (selectedOptions.length) onSubmit(selectedOptions)
          }}
        >
          <div className="multi-choice-list">
            {question.options.map((option, index) => {
              const selected = selectedOptions.includes(option)
              return (
                <label className={`multi-choice-option${selected ? ' selected' : ''}`} key={option}>
                  <input
                    checked={selected}
                    type="checkbox"
                    onChange={() => {
                      setSelectedOptions((current) =>
                        current.includes(option) ? current.filter((value) => value !== option) : [...current, option],
                      )
                    }}
                  />
                  <span>{translatedOptions[index]}</span>
                </label>
              )
            })}
          </div>
          <button disabled={!selectedOptions.length} type="submit"><Send size={18} />{participantText(locale, 'submitAnswer')}</button>
        </form>
      )}
      {!answer && !isAudioQuestion && question.status === 'active' && question.type !== 'short_answer' && !question.allow_multiple && (
        <div className="choice-list">
          {question.options.map((option, index) => (
            <button key={option} type="button" onClick={() => onSubmit(option)}>
              {translatedOptions[index]}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
