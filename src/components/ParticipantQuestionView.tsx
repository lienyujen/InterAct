import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Send } from 'lucide-react'
import { AudioRecorder } from './AudioRecorder'
import { participantText } from '../lib/participantI18n'
import { answerDeadline, formatSeconds, useSecondsLeft } from '../lib/questionTiming'
import { HotspotImage } from './HotspotImage'
import { MatchingAnswer, OrderingAnswer } from './OrderingAnswer'
import { parsePins, serialisePins } from '../lib/hotspot'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { Answer, AudioResponse, Question } from '../types'

type Props = {
  question: Question | null
  answer: Answer | null
  audioBusy: boolean
  audioResponse: AudioResponse | null
  onSubmit: (value: string | string[]) => void
  // Ordering and matching are marked server-side against a key the student
  // cannot read, so they take their own path rather than the answers insert.
  onSubmitOrdered: (values: string[]) => Promise<void>
  orderedBusy: boolean
  // The dispatched screenshot, which a hotspot question is answered on.
  imageUrl?: string | null
  onSubmitAudio: (file: File, durationMs: number) => Promise<void>
  locale?: ParticipantLocale
}

export function ParticipantQuestionView({ question, answer, audioBusy, audioResponse, imageUrl, orderedBusy, onSubmit, onSubmitOrdered, onSubmitAudio, locale = 'zh-TW' }: Props) {
  const [textAnswer, setTextAnswer] = useState('')
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [pins, setPins] = useState<Array<{ x: number; y: number }>>([])
  const secondsLeft = useSecondsLeft(question ? answerDeadline(question) : null)

  useEffect(() => {
    setTextAnswer('')
    setSelectedOptions([])
    setPins([])
  }, [question?.id])

  // file_upload has its own panel further up the page, carrying the same prompt
  // and the screenshot; rendering here as well would print the question twice.
  // 'board' draws itself, lower down the page and with its own composer, so
  // rendering it here as well showed the class the same topic twice.
  if (!question || ['send_screen', 'custom_quiz', 'file_upload', 'board'].includes(question.type)) return null
  const isAudioQuestion = question.type === 'pronunciation' || question.type === 'oral_response'
  // The clock running out and the teacher stopping the question are separate
  // things and the student is told which happened: "it closed" and "the teacher
  // closed it" call for different reactions, and one message for both makes the
  // app feel arbitrary.
  const timeUp = secondsLeft === 0
  const acceptingAnswers = question.status === 'active' && !timeUp
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
      {secondsLeft !== null && secondsLeft > 0 && question.status === 'active' && (
        <p aria-live="off" className={`answer-countdown${secondsLeft <= 10 ? ' is-urgent' : ''}`}>
          {participantText(locale, 'timeLeft')} {formatSeconds(secondsLeft)}
        </p>
      )}
      {question.status !== 'active' && <p className="muted">{participantText(locale, 'questionEnded')}</p>}
      {question.status === 'active' && timeUp && <p className="muted">{participantText(locale, 'answerClosed')}</p>}
      {isAudioQuestion && (
        <AudioRecorder busy={audioBusy} locale={locale} question={question} response={audioResponse} onSubmit={onSubmitAudio} />
      )}
      {answer && !isAudioQuestion && !['hotspot', 'ordering', 'matching'].includes(question.type) && <p className="success">{participantText(locale, 'submittedAnswer')}{answer.answer_values?.map(displayAnswer).join(locale === 'en' ? ', ' : '、') || (answer.answer_value ? displayAnswer(answer.answer_value) : answer.answer_text)}</p>}
      {answer && question.type === 'hotspot' && (
        <p className="success">{participantText(locale, 'answerSent')}</p>
      )}
      {question.type === 'ordering' && !answer && acceptingAnswers && (
        <OrderingAnswer
          busy={orderedBusy}
          items={question.options}
          sentenceMode={question.sentence_mode}
          locale={locale}
          onSubmit={(ordered) => void onSubmitOrdered(ordered)}
        />
      )}
      {question.type === 'matching' && !answer && acceptingAnswers && (
        <MatchingAnswer
          busy={orderedBusy}
          choices={question.choices}
          locale={locale}
          prompts={question.options}
          onSubmit={(chosen) => void onSubmitOrdered(chosen)}
        />
      )}
      {answer && ['ordering', 'matching'].includes(question.type) && (
        <p className={answer.is_correct === false ? 'error' : 'success'}>
          {answer.is_correct === true ? participantText(locale, 'answerCorrect')
            : answer.is_correct === false ? participantText(locale, 'answerWrong')
            : participantText(locale, 'answerSent')}
        </p>
      )}
      {question.type === 'hotspot' && imageUrl && (
        <div className="participant-hotspot">
          <HotspotImage
            alt={participantText(locale, 'imageAlt')}
            imageUrl={imageUrl}
            pins={(answer ? parsePins(answer.answer_values) : pins).map((pin, index) => ({ ...pin, label: String(index + 1), own: true }))}
            onPlace={!answer && acceptingAnswers
              ? (point) => setPins((current) => (
                // Full is full. Silently dropping the oldest to make room reads as
                // "my first mark jumped to where I tapped", because a pin sits above
                // the spot it marks — so a student aiming at their own mark hits the
                // picture instead, and loses one they meant to keep.
                current.length >= (question.max_pins || 1) ? current : [...current, point]
              ))
              : undefined}
            onRemove={!answer && acceptingAnswers
              ? (index) => setPins((current) => current.filter((_, at) => at !== index))
              : undefined}
          />
          {!answer && acceptingAnswers && (
            <div className="participant-hotspot-actions">
              {/* What is left, not what is used: the student is deciding whether
                  to spend another tap, and 剩 1 次 answers that where 2 / 3 does not. */}
              <span className="muted">
                {pins.length < (question.max_pins || 1)
                  ? participantText(locale, 'pinsLeft').replace('{n}', String((question.max_pins || 1) - pins.length))
                  : participantText(locale, 'pinsUsed')}
              </span>
              <button disabled={!pins.length} type="button" onClick={() => onSubmit(serialisePins(pins))}>
                <Send size={18} />{participantText(locale, 'submitAnswer')}
              </button>
            </div>
          )}
        </div>
      )}
      {!answer && acceptingAnswers && question.type === 'short_answer' && (
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
      {!answer && !isAudioQuestion && acceptingAnswers && !['short_answer', 'hotspot', 'ordering', 'matching'].includes(question.type) && question.allow_multiple && (
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
      {!answer && !isAudioQuestion && acceptingAnswers && !['short_answer', 'hotspot', 'ordering', 'matching'].includes(question.type) && !question.allow_multiple && (
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
