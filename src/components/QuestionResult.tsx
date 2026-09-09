import { ArrowDownUp, AudioLines, CheckCircle2, Dice5, Download, FileUp, LoaderCircle, Shuffle, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { correctnessStats, countByAnswer } from '../lib/stats'
import { downloadHref } from '../lib/fileLinks'
import { formatSeconds, presenterDeadline, useSecondsLeft } from '../lib/questionTiming'
import { HotspotImage } from './HotspotImage'
import { parsePins, pinLabel } from '../lib/hotspot'
import { QuestionStopControl } from './QuestionStopControl'
import type { Answer, AudioResponse, FileResponse, Question, QuestionAnalysis } from '../types'

type Props = {
  anonymousEnabled: boolean
  question: Question | null
  answers: Answer[]
  audioResponses: AudioResponse[]
  fileResponses: FileResponse[]
  // Which upload is being marked right now, and how far a mark-everything run has got.
  fileBusyId: string
  gradeProgress: { done: number; total: number } | null
  analysis: QuestionAnalysis | null
  analysisBusy: boolean
  analysisError: string
  busy: boolean
  isCurrentQuestion: boolean
  onlineCount: number
  onAnalyze: () => void
  onAnalyzeFile: (responseId: string) => void
  onStopQuestion: () => Promise<void>
  onResumeQuestion: () => Promise<void>
  onNextRound: () => Promise<void>
  // The dispatched screenshot, which the class's taps are drawn back onto.
  screenshotUrl: string | null
  onDrawUnanswered: (questionId: string) => void
  onSetCorrectAnswer: (answer: string) => void
  // The ordering or matching key, empty when the question was dispatched without
  // one. It never reaches the student, so the presenter reads it from here.
  orderingKey: string[]
  onSetOrderingKey: (values: string[]) => Promise<void>
}

type AnalysisProps = Pick<Props,
  'question' | 'answers' | 'analysis' | 'analysisBusy' | 'analysisError' | 'onAnalyze' | 'onSetCorrectAnswer'
  | 'fileResponses' | 'gradeProgress' | 'audioResponses'>

function ItemList({ items }: { items: string[] }) {
  if (!items.length) return <p className="muted">目前沒有可列出的項目。</p>
  return (
    <ul className="analysis-list">
      {items.map((item) => <li key={item}>{item}</li>)}
    </ul>
  )
}

function QuestionStatusActions({
  busy,
  isCurrentQuestion,
  onlineCount,
  onDrawUnanswered,
  onStopQuestion,
  onResumeQuestion,
  onNextRound,
  question,
}: Pick<Props, 'busy' | 'isCurrentQuestion' | 'onlineCount' | 'onDrawUnanswered' | 'onStopQuestion' | 'onResumeQuestion' | 'onNextRound'> & { question: Question }) {
  // The presenter has to see the clock the class is watching, or they are
  // deciding when to move on blind — which is the whole reason a timed
  // question was set. Same function as the student's, so the two agree.
  const secondsLeft = useSecondsLeft(presenterDeadline(question))
  const canDrawUnanswered = isCurrentQuestion
    && question.type !== 'send_screen'
    && (question.status === 'stopped' || question.status === 'closed')

  return (
    <div className="question-heading-actions">
      {secondsLeft !== null && question.status === 'active' && (
        <span aria-live="off" className={`question-countdown${secondsLeft <= 10 ? ' is-urgent' : ''}`}>
          {formatSeconds(secondsLeft)}
        </span>
      )}
      {canDrawUnanswered && (
        <button
          aria-label="抽選本題未作答學生"
          className="question-unanswered-draw"
          disabled={busy || !onlineCount}
          title={onlineCount ? '抽選目前線上且未作答本題的學生' : '目前沒有線上學生'}
          type="button"
          onClick={() => onDrawUnanswered(question.id)}
        >
          <Dice5 size={20} />
        </button>
      )}
      <QuestionStopControl
        busy={busy}
        isCurrentQuestion={isCurrentQuestion}
        question={question}
        canRepeat={['poll', 'multiple_choice', 'true_false', 'short_answer', 'hotspot', 'ordering', 'matching'].includes(question.type)}
        onNextRound={onNextRound}
        onResume={onResumeQuestion}
        onStop={onStopQuestion}
      />
      <span className={`status ${question.status}`}>{question.status}</span>
    </div>
  )
}

function AiAnalysisPanel({
  question, answers, analysis, analysisBusy, analysisError, fileResponses, audioResponses, gradeProgress, onAnalyze, onSetCorrectAnswer,
}: AnalysisProps) {
  if (!question || question.type === 'send_screen') return null

  const isUpload = question.type === 'file_upload'
  // A spoken answer is already assessed one student at a time; what this adds
  // is the reading across the room that no individual evaluation can give.
  const isSpoken = question.type === 'pronunciation' || question.type === 'oral_response'
  const assessed = isSpoken
    ? audioResponses.filter((response) => response.analysis_status === 'success').length
    : 0
  // Counted in students, because that is what a press costs: one call covers
  // every page one student sent.
  const unmarked = isUpload
    ? new Set(fileResponses
      .filter((response) => ['pending', 'failed'].includes(response.analysis_status))
      .map((response) => response.participant_id)).size
    : 0
  const canAnalyze = question.status !== 'active'
    && (isUpload ? fileResponses.length > 0 : isSpoken ? assessed > 0 : answers.length > 0)
  const suggestion = analysis?.question_understanding.suggested_correct_answer
  const canApplySuggestion = Boolean(
    suggestion
    && (question.type === 'multiple_choice' || question.type === 'true_false')
    && !question.allow_multiple
    && question.options.includes(suggestion),
  )

  return (
    <section className="panel ai-analysis-panel">
      <div className="panel-heading">
        <h2><Sparkles size={18} />AI 完整分析</h2>
        <button disabled={!canAnalyze || analysisBusy} type="button" onClick={onAnalyze}>
          <Sparkles size={16} />
          {analysisBusy
            ? gradeProgress ? `批改中 ${gradeProgress.done}/${gradeProgress.total}...` : '分析中...'
            : isUpload
              ? unmarked ? `批改剩下 ${unmarked} 人並分析` : analysis ? '重新分析' : '分析全班'
              : isSpoken
                ? analysis ? '重新分析' : '綜整全班口說'
              : analysis ? '重新分析' : 'AI 分析'}
        </button>
      </div>
      {!canAnalyze && (
        <p className="muted">
          {isSpoken
            ? '停止作答、且至少有一份錄音完成 AI 評測後，才能綜整全班。'
            : '停止作答且至少收到一份答案後，即可手動執行分析。'}
        </p>
      )}
      {canAnalyze && isUpload && (
        // Marking is the expensive half, so say plainly what this button will and
        // will not spend: work already paid for is never redone.
        <p className="muted">
          {unmarked
            ? `會先批改尚未批改的 ${unmarked} 人，已批改過的不再重算，再彙整全班表現。`
            : '每個人都批改過了，這一步只讀批改結果彙整全班表現。'}
        </p>
      )}
      {canAnalyze && isSpoken && (
        // Reads the individual evaluations rather than the recordings, so the
        // class summary costs one text call however many students spoke.
        <p className="muted">讀取 {assessed} 份已完成的 AI 評測，綜整全班的發音與表達，不會重新聽錄音。</p>
      )}
      {analysisError && <p className="error">{analysisError}</p>}
      {analysis && (
        <div className="analysis-content">
          <section>
            <h3>題目判讀</h3>
            <p>{analysis.question_understanding.detected_question}</p>
            <p className="muted">
              {analysis.question_understanding.subject} · {analysis.question_understanding.concepts.join('、')}
            </p>
            {suggestion && (
              <div className="ai-suggestion">
                <span>AI 建議答案：<strong>{suggestion}</strong></span>
                <span>信心：{analysis.question_understanding.confidence}</span>
                {canApplySuggestion && (
                  <button className="ghost-button" type="button" onClick={() => onSetCorrectAnswer(suggestion)}>
                    <CheckCircle2 size={16} />採用為正確答案
                  </button>
                )}
              </div>
            )}
            <p>{analysis.question_understanding.reasoning}</p>
          </section>

          <details open>
            <summary>作答理解</summary>
            <p>{analysis.response_analysis.understanding_summary}</p>
            <p className="muted">
              作答 {analysis.response_analysis.response_count} 人 · 回覆率 {analysis.response_analysis.response_rate}%
            </p>
            <h4>已掌握</h4>
            <ItemList items={analysis.response_analysis.strengths} />
            <h4>可能誤解</h4>
            <ItemList items={analysis.response_analysis.misconceptions} />
            <h4>代表性作答模式</h4>
            <ItemList items={analysis.response_analysis.representative_patterns} />
          </details>

          <details open>
            <summary>教學建議</summary>
            <h4>立即處理</h4>
            <ItemList items={analysis.teaching_recommendations.immediate_actions} />
            <h4>講解重點</h4>
            <ItemList items={analysis.teaching_recommendations.explanation_points} />
            <h4>追問題目</h4>
            <ItemList items={analysis.teaching_recommendations.follow_up_questions} />
          </details>

          {analysis.limitations.length > 0 && (
            <details>
              <summary>分析限制</summary>
              <ItemList items={analysis.limitations} />
            </details>
          )}
        </div>
      )}
    </section>
  )
}

const verdictLabels: Record<string, string> = {
  correct: '正確',
  partial: '部分正確',
  incorrect: '不正確',
  unscored: '未評分',
}

const uploadStatusLabels: Record<FileResponse['analysis_status'], string> = {
  pending: '尚未批改',
  analyzing: '批改中...',
  success: '已批改',
  failed: '批改失敗',
  unsupported: 'AI 無法讀取此格式',
}

function isImageFile(mimeType: string, name: string) {
  return mimeType.startsWith('image/') || /.(png|jpe?g|webp|gif|heic|heif)$/i.test(name)
}

// One row per student, not per file: an essay photographed as three pages is
// one answer, and the marker treats it that way too.
function UploadResults({
  anonymousEnabled, fileBusyId, fileResponses, question, onAnalyzeFile,
}: Pick<Props, 'anonymousEnabled' | 'fileBusyId' | 'fileResponses' | 'onAnalyzeFile'> & { question: Question }) {
  const [expanded, setExpanded] = useState('')

  const submissions = useMemo(() => {
    const groups = new Map<string, FileResponse[]>()
    for (const response of fileResponses) {
      const existing = groups.get(response.participant_id)
      if (existing) existing.push(response)
      else groups.set(response.participant_id, [response])
    }
    // A student's own files are ordered so the one carrying the mark leads:
    // a stray .docx first would otherwise present the whole submission as
    // unreadable and hide the button that would have marked their photo.
    const rank = (response: FileResponse) => response.analysis_status === 'success' ? 0
      : response.analysis_status === 'unsupported' ? 2 : 1
    return [...groups.values()].map((files) => [...files].sort((left, right) => rank(left) - rank(right)))
  }, [fileResponses])

  const marked = submissions.filter((files) => files[0].analysis_status === 'success').length

  if (!submissions.length) {
    return (
      <p className="muted">
        {question.status === 'active' ? '還沒有學生上傳作答。' : '這一題沒有收到任何上傳。'}
      </p>
    )
  }

  return (
    <>
      <p className="muted">已上傳 {submissions.length} 人 · 已批改 {marked} 人</p>
      <ul className="file-list upload-answer-list">
        {submissions.map((files, index) => {
          const lead = files[0]
          const result = lead.analysis_json
          const verdict = result?.verdict || ''
          const busy = files.some((file) => fileBusyId === file.id || file.analysis_status === 'analyzing')
          const preview = files.find((file) => isImageFile(file.mime_type, file.name) && file.file_url)
          const failure = files.find((file) => file.error_message && file.analysis_status !== 'success')
          return (
            <li key={lead.participant_id}>
              <div className="file-response-row">
                {preview ? (
                  <a href={preview.file_url} rel="noreferrer" target="_blank">
                    <img alt={preview.name} className="file-response-thumb" src={preview.file_url} />
                  </a>
                ) : <span className="file-response-thumb is-placeholder"><FileUp size={18} /></span>}
                <div className="file-list-meta">
                  <strong>{anonymousEnabled ? `匿名作答 ${index + 1}` : lead.participant_name}</strong>
                  <span className="muted">
                    {files.map((file) => file.name).join('、')}
                    {files.length > 1 && ` · ${files.length} 個檔案`}
                  </span>
                  <span className="upload-verdict-line">
                    {verdict && <span className={`file-verdict is-${verdict}`}>{verdictLabels[verdict] || verdict}</span>}
                    {typeof result?.score === 'number' && <span className="upload-score">{result.score} 分</span>}
                    {!verdict && (
                      <span className={`file-analysis-status is-${lead.analysis_status}`}>
                        {uploadStatusLabels[lead.analysis_status]}
                      </span>
                    )}
                  </span>
                </div>
                <div className="file-list-actions">
                  {files.filter((file) => file.file_url).map((file, fileIndex) => (
                    <a
                      className="ghost-button"
                      href={downloadHref(file.file_url as string, file.name)}
                      key={file.id}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Download size={15} />下載{files.length > 1 ? ` ${fileIndex + 1}` : ''}
                    </a>
                  ))}
                  {lead.analysis_status !== 'unsupported' && (
                    <button disabled={busy} type="button" onClick={() => onAnalyzeFile(lead.id)}>
                      {busy ? <LoaderCircle className="spin" size={15} /> : <Sparkles size={15} />}
                      {lead.analysis_status === 'success' ? '重批' : 'AI 批改'}
                    </button>
                  )}
                  {lead.analysis_status === 'success' && (
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setExpanded(expanded === lead.participant_id ? '' : lead.participant_id)}
                    >
                      {expanded === lead.participant_id ? '收合' : '看批改'}
                    </button>
                  )}
                </div>
              </div>
              {failure && <p className="muted file-analysis-error">{failure.error_message}</p>}
              {expanded === lead.participant_id && result && (
                <div className="file-analysis-detail">
                  <p>{result.summary_zh_tw}</p>
                  {result.strengths_zh_tw.length > 0 && (
                    <>
                      <h4>做得好</h4>
                      <ul>{result.strengths_zh_tw.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                    </>
                  )}
                  {result.improvements_zh_tw.length > 0 && (
                    <>
                      <h4>可改進</h4>
                      <ul>{result.improvements_zh_tw.map((item, itemIndex) => <li key={itemIndex}>{item}</li>)}</ul>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </>
  )
}

function RoundComparison({ answers, question, correctAnswers }: {
  answers: Answer[]
  question: Question
  correctAnswers: string[]
}) {
  const rounds = useMemo(() => {
    const byRound = new Map<number, Answer[]>()
    for (const answer of answers) {
      const list = byRound.get(answer.round) || []
      list.push(answer)
      byRound.set(answer.round, list)
    }
    return [...byRound.entries()].sort((a, b) => a[0] - b[0])
  }, [answers])

  if (rounds.length < 2) return null

  const [firstRound, ...rest] = rounds
  const latestRound = rest[rest.length - 1]
  // The whole answer, not its first value: a student who reordered everything
  // but the opening item has changed their mind, and comparing only that item
  // would report the round as having moved nobody.
  const pick = (entry: Answer) => entry.answer_values?.length
    ? entry.answer_values.join('、')
    : entry.answer_value || entry.answer_text || ''
  // Ordering and matching are marked server-side, so the row already knows
  // whether it was right; everything else is judged against the key the
  // presenter set on the question.
  const marked = ['ordering', 'matching'].includes(question.type)
  const wasCorrect = (entry: Answer) => marked ? entry.is_correct === true : correctAnswers.includes(pick(entry))
  const scored = marked
    ? latestRound[1].some((entry) => entry.is_correct !== null)
    : correctAnswers.length > 0
  const before = new Map(firstRound[1].map((entry) => [entry.participant_id, entry]))
  const moves = new Map<string, number>()
  let changed = 0
  let gained = 0
  let lost = 0
  for (const entry of latestRound[1]) {
    const previous = before.get(entry.participant_id)
    if (!previous) continue
    const from = pick(previous)
    const to = pick(entry)
    if (from === to) continue
    changed += 1
    if (scored) {
      if (!wasCorrect(previous) && wasCorrect(entry)) gained += 1
      if (wasCorrect(previous) && !wasCorrect(entry)) lost += 1
    }
    // A whole sequence on each side of an arrow is unreadable; for those two the
    // counts above are the finding and the orders themselves are in the panel.
    if (!marked) {
      const key = `${from} → ${to}`
      moves.set(key, (moves.get(key) || 0) + 1)
    }
  }
  const rate = (list: Answer[]) => scored && list.length
    ? Math.round((list.filter(wasCorrect).length / list.length) * 100)
    : null

  return (
    <section className="panel round-comparison">
      <h2>兩輪對照</h2>
      <div className="round-summary">
        {rounds.map(([round, list]) => (
          <div key={round}>
            <strong>第 {round} 輪</strong>
            <span>{list.length} 人作答{rate(list) === null ? '' : ` · 答對 ${rate(list)}%`}</span>
          </div>
        ))}
      </div>
      <p className="muted">
        {changed
          ? `${changed} 人改了答案`
          : '沒有人改答案 —— 討論沒有動搖任何人，這本身就是一個發現。'}
        {scored && changed ? ` · 改對 ${gained} 人、改錯 ${lost} 人` : ''}
      </p>
      {moves.size > 0 && (
        <ul className="round-moves">
          {[...moves.entries()].sort((a, b) => b[1] - a[1]).map(([move, count]) => (
            <li key={move}><span>{move}</span><b>{count} 人</b></li>
          ))}
        </ul>
      )}
      {question.status === 'active' && <p className="muted">第 {latestRound[0]} 輪還在作答中。</p>}
    </section>
  )
}

// Setting the key by clicking the items in order rather than typing position
// numbers into boxes: clicking cannot produce "two items in slot 3", which is
// the mistake a numbered form invites and which would mark the whole class wrong.
function OrderingKeyEditor({ items, current, busy, onSubmit }: {
  items: string[]
  current: string[]
  busy: boolean
  onSubmit: (values: string[]) => Promise<void>
}) {
  const [order, setOrder] = useState<string[]>(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(!current.length)

  const complete = order.length === items.length
  const unchanged = order.length === current.length && order.every((value, index) => value === current[index])

  async function save(values: string[]) {
    setSaving(true)
    setError('')
    try {
      await onSubmit(values)
      setOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '設定答案失敗。')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <div className="ordering-key-set">
        <button className="ghost-button" disabled={busy} type="button" onClick={() => { setOrder(current); setOpen(true) }}>
          修改正確順序
        </button>
      </div>
    )
  }

  return (
    <div className="ordering-key-editor">
      <p className="muted">依正確順序點選項目，點第二次可以取消。</p>
      <ul className="ordering-list">
        {items.map((item) => {
          const position = order.indexOf(item)
          return (
            <li key={item}>
              <button
                className={`ordering-option${position >= 0 ? ' is-placed' : ''}`}
                disabled={busy || saving}
                type="button"
                onClick={() => setOrder((now) => now.includes(item)
                  ? now.filter((value) => value !== item)
                  : [...now, item])}
              >
                <span className="ordering-rank">{position >= 0 ? position + 1 : ''}</span>
                <span>{item}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="ordering-actions">
        <span className="muted">{order.length} / {items.length}</span>
        <button disabled={busy || saving || !complete || unchanged} type="button" onClick={() => void save(order)}>
          <CheckCircle2 size={16} />送出答案
        </button>
        {current.length > 0 && (
          // Back to an open question. A key set by mistake otherwise leaves the
          // whole class marked wrong with no way out but re-dispatching.
          <button className="ghost-button" disabled={busy || saving} type="button" onClick={() => void save([])}>
            改為無標準答案
          </button>
        )}
        {current.length > 0 && (
          <button className="ghost-button" disabled={busy || saving} type="button" onClick={() => setOpen(false)}>取消</button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

function MatchingKeyEditor({ prompts, choices, current, busy, onSubmit }: {
  prompts: string[]
  choices: string[]
  current: string[]
  busy: boolean
  onSubmit: (values: string[]) => Promise<void>
}) {
  const [picked, setPicked] = useState<string[]>(() => prompts.map((_, index) => current[index] || ''))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(!current.length)
  const complete = picked.every(Boolean)
  const unchanged = picked.every((value, index) => value === (current[index] || ''))

  // The same swap the student widget does: a key with one choice used twice is
  // one no answer can match, so it is not a state the form should be able to reach.
  function choose(index: number, value: string) {
    setPicked((now) => {
      const held = value ? now.indexOf(value) : -1
      return now.map((entry, at) => at === index ? value : at === held ? now[index] : entry)
    })
  }

  // Folded away once it is set, the same as the ordering editor: a panel the
  // presenter is reading results from should not open on a form.
  if (!open) {
    return (
      <div className="ordering-key-set">
        <button className="ghost-button" disabled={busy} type="button" onClick={() => setOpen(true)}>修改正確配對</button>
      </div>
    )
  }

  return (
    <div className="ordering-key-editor">
      <p className="muted">為每一個題目指定正確的配對。</p>
      <ul className="matching-list">
        {prompts.map((prompt, index) => (
          <li key={prompt}>
            <span className="matching-prompt">{prompt}</span>
            <select
              aria-label={prompt}
              disabled={busy || saving}
              value={picked[index]}
              onChange={(event) => choose(index, event.target.value)}
            >
              <option value="">—</option>
              {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
            </select>
          </li>
        ))}
      </ul>
      <div className="ordering-actions">
        <button
          disabled={busy || saving || !complete || unchanged}
          type="button"
          onClick={() => {
            setSaving(true)
            setError('')
            onSubmit(picked)
              .then(() => setOpen(false))
              .catch((caught) => setError(caught instanceof Error ? caught.message : '設定答案失敗。'))
              .finally(() => setSaving(false))
          }}
        >
          <CheckCircle2 size={16} />送出答案
        </button>
        {current.length > 0 && (
          <button className="ghost-button" disabled={busy || saving} type="button" onClick={() => setOpen(false)}>取消</button>
        )}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}

// Where a marked ordering question went wrong. Not a list of every sequence the
// class produced — with six items there are 720 of them — but the ones more than
// one student arrived at, which is where a shared misunderstanding shows.
function OrderingMistakes({ answers, correctValues }: { answers: Answer[]; correctValues: string[] }) {
  const wrong = new Map<string, number>()
  for (const entry of answers) {
    const given = entry.answer_values || []
    if (given.length === correctValues.length && correctValues.every((value, index) => value === given[index])) continue
    const key = given.join(' → ')
    if (key) wrong.set(key, (wrong.get(key) || 0) + 1)
  }
  const shared = [...wrong.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  if (!shared.length) return null
  return (
    <>
      <h3 className="ordering-subheading">最常見的錯誤順序</h3>
      <ul className="ordering-mistakes">
        {shared.map(([sequence, count]) => (
          <li key={sequence}><span>{sequence}</span><b>{count} 人</b></li>
        ))}
      </ul>
    </>
  )
}

// The unmarked case the presenter asked for: every item against every position,
// so a class that agrees on the first two steps and splits on the rest reads as
// exactly that.
function OrderingSpread({ items, answers }: { items: string[]; answers: Answer[] }) {
  const counts = items.map((item) => items.map((_, position) =>
    answers.filter((entry) => (entry.answer_values || [])[position] === item).length))
  // Mean position, so the consensus order is the class's own answer rather than
  // whichever single sequence happened to be most popular.
  const consensus = items
    .map((item, row) => {
      const total = counts[row].reduce((sum, count) => sum + count, 0)
      const weighted = counts[row].reduce((sum, count, position) => sum + count * (position + 1), 0)
      return { item, mean: total ? weighted / total : items.length + 1 }
    })
    .sort((a, b) => a.mean - b.mean)

  return (
    <>
      <h3 className="ordering-subheading">全班的排序分布</h3>
      <div className="ordering-matrix-scroll">
        <table className="ordering-matrix">
          <thead>
            <tr>
              <th>項目</th>
              {items.map((_, position) => <th key={position}>第 {position + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {items.map((item, row) => (
              <tr key={item}>
                <th scope="row">{item}</th>
                {counts[row].map((count, position) => {
                  const rate = answers.length ? Math.round((count / answers.length) * 100) : 0
                  return (
                    // Capped well short of solid: the darkest cell still has to be
                    // readable black-on-tint on a projector.
                    <td key={position} style={{ '--tint': `${Math.round(rate * 0.45)}%` } as CSSProperties}>
                      <span>{rate ? `${rate}%` : '·'}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="ordering-subheading">全班的共識順序</h3>
      <ol className="ordering-consensus">
        {consensus.map((entry) => <li key={entry.item}>{entry.item}</li>)}
      </ol>
    </>
  )
}

function MatchingBreakdown({ prompts, answers, correctValues }: {
  prompts: string[]
  answers: Answer[]
  correctValues: string[]
}) {
  return (
    <ul className="matching-breakdown">
      {prompts.map((prompt, index) => {
        const picks = answers.map((entry) => (entry.answer_values || [])[index]).filter(Boolean)
        const right = correctValues[index]
        const correct = picks.filter((pick) => pick === right).length
        const rate = picks.length ? Math.round((correct / picks.length) * 100) : 0
        const wrong = new Map<string, number>()
        for (const pick of picks) if (pick !== right) wrong.set(pick, (wrong.get(pick) || 0) + 1)
        const [worst] = [...wrong.entries()].sort((a, b) => b[1] - a[1])
        return (
          <li key={prompt}>
            <div className="matching-breakdown-head">
              <span className="matching-prompt">{prompt}</span>
              <b className={rate >= 60 ? 'is-good' : 'is-weak'}>{rate}%</b>
            </div>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${rate}%` }} /></div>
            <p className="muted">
              正解：{right || '尚未設定'} · 答對 {correct} / {picks.length} 人
              {worst ? ` · 最常誤選「${worst[0]}」${worst[1]} 人` : ''}
            </p>
          </li>
        )
      })}
    </ul>
  )
}

export function QuestionResult(props: Props) {
  const { anonymousEnabled, question, answers, audioResponses, analysis, onSetCorrectAnswer } = props

  if (!question) {
    return (
      <section className="panel">
        <h2>目前沒有題目</h2>
        <p className="muted">截圖派題後，作答狀態會顯示在這裡。</p>
      </section>
    )
  }

  if (question.type === 'send_screen') {
    return (
      <section className="panel result-panel">
        <div className="panel-heading">
          <h2>派送畫面</h2>
          <span className={`status ${question.status}`}>{question.status}</span>
        </div>
        <p className="muted">目前派送的是畫面，不需要作答。</p>
      </section>
    )
  }

  if (question.type === 'short_answer') {
    return (
      <>
        <section className="panel result-panel">
          <div className="panel-heading">
            <h2>問答題</h2>
            <QuestionStatusActions {...props} question={question} />
          </div>
          <p className="muted">已作答 {answers.length} 人</p>
          <div className="answer-list">
            {answers.map((answer, index) => (
              <article className="answer-item" key={answer.id}>
                <strong>{anonymousEnabled ? `匿名回答 ${index + 1}` : answer.participant_name}</strong>
                <p>{answer.answer_text}</p>
              </article>
            ))}
          </div>
        </section>
        <AiAnalysisPanel {...props} />
      </>
    )
  }

  if (question.type === 'file_upload') {
    return (
      <>
        <section className="panel result-panel upload-results-panel">
          <div className="panel-heading">
            <h2><FileUp size={20} />{question.title}</h2>
            <QuestionStatusActions {...props} question={question} />
          </div>
          {question.prompt_text && <p className="detected-question">{question.prompt_text}</p>}
          <UploadResults
            anonymousEnabled={anonymousEnabled}
            fileBusyId={props.fileBusyId}
            fileResponses={props.fileResponses}
            question={question}
            onAnalyzeFile={props.onAnalyzeFile}
          />
        </section>
        <AiAnalysisPanel {...props} />
      </>
    )
  }

  if (question.type === 'ordering' || question.type === 'matching') {
    const roundAnswers = answers.filter((entry) => entry.round === question.answer_round)
    const key = props.orderingKey
    const marked = key.length > 0
    const correct = roundAnswers.filter((entry) => entry.is_correct === true).length
    const rate = roundAnswers.length ? Math.round((correct / roundAnswers.length) * 100) : 0
    return (
      <>
        <section className="panel result-panel ordering-results-panel">
          <div className="panel-heading">
            <h2>{question.type === 'ordering' ? <ArrowDownUp size={20} /> : <Shuffle size={20} />}{question.title}</h2>
            <QuestionStatusActions {...props} question={question} />
          </div>
          {question.prompt_text && <p className="detected-question">{question.prompt_text}</p>}
          <p className="muted">
            已作答 {roundAnswers.length} 人{question.answer_round > 1 ? `（第 ${question.answer_round} 輪）` : ''}
            {marked ? ` · 答對 ${correct} 人（${rate}%）` : ' · 這一題沒有標準答案'}
          </p>
          {marked && (
            <>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${rate}%` }} /></div>
              <h3 className="ordering-subheading">{question.type === 'ordering' ? '正確順序' : '正確配對'}</h3>
              {question.type === 'ordering'
                ? <ol className="ordering-consensus is-key">{key.map((item) => <li key={item}>{item}</li>)}</ol>
                : <MatchingBreakdown answers={roundAnswers} correctValues={key} prompts={question.options} />}
              {question.type === 'ordering' && <OrderingMistakes answers={roundAnswers} correctValues={key} />}
            </>
          )}
          {/* Without a key there is nothing to be right about, so the panel shows
              what the class thought instead of how many missed it. */}
          {!marked && question.type === 'ordering' && <OrderingSpread answers={roundAnswers} items={question.options} />}
          {!marked && question.type === 'matching' && (
            <MatchingBreakdown answers={roundAnswers} correctValues={[]} prompts={question.options} />
          )}
          {question.type === 'ordering'
            ? <OrderingKeyEditor busy={props.busy} current={key} items={question.options} onSubmit={props.onSetOrderingKey} />
            : <MatchingKeyEditor busy={props.busy} choices={question.choices} current={key} prompts={question.options} onSubmit={props.onSetOrderingKey} />}
        </section>
        <RoundComparison answers={answers} correctAnswers={[]} question={question} />
      </>
    )
  }

  if (question.type === 'hotspot') {
    // Every tap the class made, back on the picture they were looking at. The
    // reading a presenter wants is not how many were wrong but where they all
    // went — eighteen pins in one place is the next thing to explain.
    const pins = answers.flatMap((entry, index) => parsePins(entry.answer_values).map((point) => ({
      ...point,
      label: pinLabel(entry.participant_name, anonymousEnabled, index),
    })))
    return (
      <section className="panel result-panel hotspot-results-panel">
        <div className="panel-heading">
          <h2>{question.title}</h2>
          <QuestionStatusActions {...props} question={question} />
        </div>
        {question.prompt_text && <p className="detected-question">{question.prompt_text}</p>}
        <p className="muted">已作答 {answers.length} 人 · 共 {pins.length} 個標記{question.max_pins && question.max_pins > 1 ? `（每人最多 ${question.max_pins} 個）` : ''}</p>
        {props.screenshotUrl
          ? <HotspotImage alt="學生點選結果" imageUrl={props.screenshotUrl} pins={pins} />
          : <p className="muted">找不到這一題的截圖。</p>}
      </section>
    )
  }

  if (question.type === 'pronunciation' || question.type === 'oral_response') {
    return (
      <>
        <section className="panel result-panel audio-results-panel">
        <div className="panel-heading">
          <h2><AudioLines size={20} />{question.title}</h2>
          <QuestionStatusActions {...props} question={question} />
        </div>
        {question.prompt_text && <p className="detected-question">{question.prompt_text}</p>}
        {/* A spoken answer has no session-wide countdown to show — each student's
            clock starts when they begin, not when the question went out. What the
            presenter needs here is confirmation that the limits they set took. */}
        {(question.prepare_seconds || question.answer_seconds) && (
          <p className="muted question-timing-summary">
            {question.prepare_seconds ? `準備 ${formatSeconds(question.prepare_seconds)}，時間到自動開始錄音` : '不準備'}
            {' · '}
            {question.answer_seconds ? `錄音最長 ${formatSeconds(question.answer_seconds)}` : '錄音不限時'}
          </p>
        )}
        <p className="muted">已錄音 {answers.length} 人</p>
        {question.status === 'active' ? (
          <p className="muted">停止作答後會顯示個別 AI 評測與錄音播放器。</p>
        ) : audioResponses.length ? (
          <div className="audio-result-list">
            {audioResponses.map((response, index) => {
              const result = response.analysis_json
              return (
                <article className="audio-result-item" key={response.id}>
                  <div className="audio-result-heading">
                    <strong>{anonymousEnabled ? `匿名回答 ${index + 1}` : response.participant_name}</strong>
                    {typeof response.score === 'number' && <span className="audio-result-score">{response.score} 分</span>}
                  </div>
                  {response.signed_url && <audio controls preload="metadata" src={response.signed_url} />}
                  {response.analysis_status === 'success' && result ? (
                    <>
                      <p className="audio-feedback-summary">{result.summary}</p>
                      <div className="audio-analysis-grid">
                        <div><strong>內容對照</strong><p>{result.relevance}</p></div>
                        <div><strong>表達清晰度</strong><p>{result.clarity}</p></div>
                        <div><strong>完成度</strong><p>{result.completeness}</p></div>
                      </div>
                      <div className="audio-feedback-section"><strong>做得好的地方</strong><ul>{result.strengths.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      <div className="audio-feedback-section"><strong>改善建議</strong><ul>{result.improvements.map((item) => <li key={item}>{item}</li>)}</ul></div>
                      <details><summary>查看辨識內容</summary><p>{result.transcript || '未辨識到語音內容'}</p></details>
                    </>
                  ) : response.analysis_status === 'failed' ? (
                    <p className="error">AI 評測失敗，錄音仍可播放。</p>
                  ) : (
                    <p className="muted">AI 評測仍在處理中。</p>
                  )}
                </article>
              )
            })}
          </div>
        ) : (
          <p className="muted">目前沒有錄音作答。</p>
        )}
        </section>
        <AiAnalysisPanel {...props} />
      </>
    )
  }

  // The bars show the round the class is on; the comparison panel below is
  // what carries the earlier ones.
  const currentRoundAnswers = answers.filter((entry) => entry.round === question.answer_round)
  const counts = countByAnswer(currentRoundAnswers)
  const correctness = correctnessStats(question, currentRoundAnswers)
  const correctAnswers = question.correct_answers?.length
    ? question.correct_answers
    : question.correct_answer
      ? [question.correct_answer]
      : []

  return (
    <>
      <section className="panel result-panel">
        <div className="panel-heading">
          <h2>{question.title}</h2>
          <QuestionStatusActions {...props} question={question} />
        </div>
        {(analysis?.question_understanding.detected_question || question.prompt_text) && (
          <p className="detected-question">{analysis?.question_understanding.detected_question || question.prompt_text}</p>
        )}
        <p className="muted">已作答 {currentRoundAnswers.length} 人{question.answer_round > 1 ? `（第 ${question.answer_round} 輪）` : ''}</p>
        <div className="option-results">
          {question.options.map((option) => {
            const count = counts[option] || 0
            const rate = currentRoundAnswers.length ? Math.round((count / currentRoundAnswers.length) * 100) : 0
            const canSetCorrectAnswer = question.status !== 'active'
              && (question.type === 'multiple_choice' || question.type === 'true_false')

            return (
              <div className="bar-row" key={option}>
                <button
                  className={correctAnswers.includes(option) ? 'correct-option' : 'ghost-button'}
                  disabled={!canSetCorrectAnswer}
                  type="button"
                  onClick={() => onSetCorrectAnswer(option)}
                >
                  {option}
                </button>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${rate}%` }} />
                </div>
                <span>{count} / {rate}%</span>
              </div>
            )
          })}
        </div>
        {correctness ? (
          <div className="correctness">
            <strong>答對 {correctness.correctRate}%</strong>
            <span>答錯 {correctness.incorrectRate}%</span>
          </div>
        ) : (
          <p className="muted">
            {question.type === 'poll'
              ? '投票題不需要正確答案。'
              : question.status === 'active'
                ? '停止作答後可設定正確答案。'
                : question.allow_multiple
                  ? '可點選一個或多個正確選項，再計算答對比例。'
                  : '點選正確選項後即可計算答對比例。'}
          </p>
        )}
      </section>
      <RoundComparison answers={answers} correctAnswers={correctAnswers} question={question} />
      <AiAnalysisPanel {...props} />
    </>
  )
}
