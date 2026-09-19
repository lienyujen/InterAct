import { CheckCircle2, XCircle } from 'lucide-react'
import { HotspotImage } from './HotspotImage'
import { parsePins } from '../lib/hotspot'
import { isImageValue } from '../lib/sliceImage'
import type { ParticipantLocale } from '../lib/participantI18n'
import type { Answer, Question, Screenshot } from '../types'

type Props = {
  answer: Answer
  correctValues: string[]
  locale: ParticipantLocale
  question: Question
  screenshot: Screenshot | null
}

// What a student sees about a question after it has closed.
//
// It used to be one line: 你的答案 followed by whatever was in the row. A
// closed question is where the learning is, so it shows three things wherever
// they exist: what was asked, what the answer was, and what this student said.

function optionText(question: Question, locale: ParticipantLocale) {
  const translated = locale === 'en' && question.translations?.en?.options?.length === question.options.length
    ? question.translations.en.options
    : question.options
  return (value: string) => {
    const index = question.options.indexOf(value)
    return index >= 0 ? translated[index] : value
  }
}

export function Verdict({ correct, locale }: { correct: boolean; locale: ParticipantLocale }) {
  const english = locale === 'en'
  return (
    <p className={`participant-review-verdict${correct ? ' is-correct' : ' is-wrong'}`}>
      {correct ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
      {correct ? (english ? 'Correct' : '答對了') : (english ? 'Not quite' : '答錯了')}
    </p>
  )
}

function Sequence({ label, values, display }: { label: string; values: string[]; display: (value: string) => string }) {
  // A sliced ordering answers with image tiles, so the pieces are shown rather
  // than their storage paths, which read as nothing at all.
  const images = values.some(isImageValue)
  return (
    <div className="participant-review-line">
      <span className="participant-review-label">{label}</span>
      {images ? (
        <div className="participant-review-tiles">
          {values.map((value, index) => <img alt={`${index + 1}`} key={`${value}-${index}`} src={value} />)}
        </div>
      ) : (
        <ol className="participant-review-sequence">
          {values.map((value, index) => <li key={`${value}-${index}`}>{display(value)}</li>)}
        </ol>
      )}
    </div>
  )
}

export function ParticipantAnswerReview({ answer, correctValues, locale, question, screenshot }: Props) {
  const english = locale === 'en'
  const display = optionText(question, locale)
  const yours = english ? 'Your answer' : '你的答案'
  const theAnswer = english ? 'Correct answer' : '正確答案'

  // 圖上點選: the picture with the taps on it. Coordinates are how the answer
  // is stored, not something a person can read.
  if (question.type === 'hotspot') {
    const pins = parsePins(answer.answer_values).map((point, index) => ({
      ...point,
      label: String(index + 1),
      own: true,
    }))
    return (
      <div className="participant-review">
        <span className="participant-review-label">{yours}</span>
        {screenshot ? (
          <HotspotImage alt={english ? 'Where you tapped' : '你點的位置'} imageUrl={screenshot.public_url} pins={pins} />
        ) : (
          <p className="muted">{english ? `${pins.length} marks` : `${pins.length} 個標記`}</p>
        )}
      </div>
    )
  }

  // 配對題 is pairs, and a list of the right-hand halves on their own is
  // unreadable: a student cannot tell which prompt they put 'Update' against.
  // options holds the prompts and the answer holds what was matched to each,
  // in the same order, so they belong side by side.
  if (question.type === 'matching') {
    const given = answer.answer_values || []
    const translatedPrompts = english && question.translations?.en?.options?.length === question.options.length
      ? question.translations.en.options
      : question.options
    return (
      <div className="participant-review">
        {answer.is_correct !== null && <Verdict correct={Boolean(answer.is_correct)} locale={locale} />}
        <table className="participant-review-pairs">
          <thead>
            <tr>
              <th>{english ? 'Prompt' : '題目'}</th>
              <th>{yours}</th>
              {correctValues.length > 0 && <th>{theAnswer}</th>}
            </tr>
          </thead>
          <tbody>
            {question.options.map((prompt, index) => {
              const mine = given[index]
              const right = correctValues[index]
              const wrong = Boolean(right) && mine !== right
              return (
                <tr className={wrong ? 'is-wrong' : undefined} key={`${prompt}-${index}`}>
                  <td>{translatedPrompts[index] || prompt}</td>
                  <td><strong>{mine || (english ? '(blank)' : '（未配對）')}</strong></td>
                  {correctValues.length > 0 && <td>{right}</td>}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  // 排序題 is one sequence, so the order itself is the answer.
  if (question.type === 'ordering') {
    const given = answer.answer_values || []
    return (
      <div className="participant-review">
        {answer.is_correct !== null && <Verdict correct={Boolean(answer.is_correct)} locale={locale} />}
        <Sequence display={display} label={yours} values={given} />
        {correctValues.length > 0 && !answer.is_correct && (
          <Sequence display={display} label={theAnswer} values={correctValues} />
        )}
      </div>
    )
  }

  // Everything else answers with words or a choice.
  const given = answer.answer_values?.length
    ? answer.answer_values.map(display).join(english ? ', ' : '、')
    : answer.answer_value
      ? display(answer.answer_value)
      : answer.answer_text || ''
  // 投票題 has no right answer, and saying so is better than an empty space.
  const correct = question.type === 'poll' ? [] : question.correct_answers || []

  return (
    <div className="participant-review">
      {answer.is_correct !== null && <Verdict correct={Boolean(answer.is_correct)} locale={locale} />}
      <p className="participant-review-line">
        <span className="participant-review-label">{yours}</span>
        <strong>{given || (english ? '(blank)' : '（未填）')}</strong>
      </p>
      {correct.length > 0 && (
        <p className="participant-review-line">
          <span className="participant-review-label">{theAnswer}</span>
          <strong>{correct.map(display).join(english ? ', ' : '、')}</strong>
        </p>
      )}
      {question.type === 'poll' && (
        <p className="muted">{english ? 'A poll has no right answer.' : '投票題沒有標準答案。'}</p>
      )}
    </div>
  )
}
