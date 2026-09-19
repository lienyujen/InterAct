import { ArrowDownUp, AudioLines, CheckCircle2, ChevronLeft, ChevronRight, Dice5, Download, Eye, EyeOff, FileUp, LoaderCircle, Maximize2, PencilLine, RotateCcw, Settings2, Shuffle, Sparkles, SquareX, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import { correctnessStats, countByAnswer } from '../lib/stats'
import { downloadHref } from '../lib/fileLinks'
import { createZip, safeFileName, uniqueName } from '../lib/zip'
import type { ZipEntry } from '../lib/zip'
import { formatSeconds, presenterDeadline, useSecondsLeft } from '../lib/questionTiming'
import { BoardWall } from './BoardWall'
import { FileTypeIcon } from './FileTypeIcon'
import { isImageFileName } from '../lib/fileKinds'
import { boardAction, loadBoard } from '../lib/boardData'
import type { BoardSnapshot } from '../lib/boardData'
import { HotspotImage } from './HotspotImage'
import { parsePins, pinColor, pinLabel } from '../lib/hotspot'
import { isImageValue } from '../lib/sliceImage'
import { QuestionStopControl } from './QuestionStopControl'
import { TimingRow } from './TimingRow'
import { MatchingBoard } from './MatchingBoard'
import { SortableList } from './SortableList'
import { joinSequence } from '../lib/ordering'
import type { Answer, AudioResponse, BoardPostKind, FileResponse, Question, QuestionAnalysis } from '../types'

const BOARD_FORMAT_LABELS: Array<[BoardPostKind, string]> = [
  ['text', '文字'], ['link', '連結'], ['image', '圖片'], ['file', '檔案'], ['audio', '錄音'], ['drawing', '電繪'],
]

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
  // Any question, not just the current one: this is what makes an older one
  // current again.
  onRecallQuestion: (questionId: string) => Promise<void>
  // The dispatched screenshot, which the class's taps are drawn back onto.
  screenshotUrl: string | null
  onDrawUnanswered: (questionId: string) => void
  onSetCorrectAnswer: (answer: string) => void
  // The ordering or matching key, empty when the question was dispatched without
  // one. It never reaches the student, so the presenter reads it from here.
  // null while it is still being fetched. The panel must not read an empty key
  // as "this question has no answer" before the answer has had a chance to load.
  orderingKey: string[] | null
  onSetOrderingKey: (values: string[]) => Promise<void>
}

type AnalysisProps = Pick<Props,
  'question' | 'answers' | 'analysis' | 'analysisBusy' | 'analysisError' | 'onAnalyze' | 'onSetCorrectAnswer'
  | 'fileResponses' | 'gradeProgress' | 'audioResponses'> & {
  // How many cards are on the board. Cards live in their own table and never
  // reach `answers`, so without this the panel would read a busy wall as empty
  // and never let the presenter press the button.
  boardCardCount?: number
}

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
  onRecallQuestion,
  question,
}: Pick<Props, 'busy' | 'isCurrentQuestion' | 'onlineCount' | 'onDrawUnanswered' | 'onStopQuestion' | 'onResumeQuestion' | 'onNextRound' | 'onRecallQuestion'> & { question: Question }) {
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
        onRecall={() => onRecallQuestion(question.id)}
        onResume={onResumeQuestion}
        onStop={onStopQuestion}
      />
      <span className={`status ${question.status}`}>{question.status}</span>
    </div>
  )
}

function AiAnalysisPanel({
  question, answers, analysis, analysisBusy, analysisError, fileResponses, audioResponses, gradeProgress, onAnalyze, onSetCorrectAnswer,
  boardCardCount = 0,
}: AnalysisProps) {
  if (!question || question.type === 'send_screen') return null

  const isBoard = question.type === 'board'
  // 電寫題 arrives as one marked image per student, exactly as an upload
  // does, so the marking button and its wording are the same button.
  const isUpload = question.type === 'file_upload' || question.type === 'drawing'
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
  const canAnalyze = isBoard
    ? boardCardCount > 0
    : question.status !== 'active'
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
          {isBoard
            ? '討論板上還沒有內容可以分析。'
            : isSpoken
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

type Plate = { url: string; name: string; owner: string; verdict: string; score: number | null }

function SubmissionViewer({ plates, index, onClose, onMove }: {
  plates: Plate[]
  index: number
  onClose: () => void
  onMove: (delta: number) => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') onMove(1)
      if (event.key === 'ArrowLeft') onMove(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onMove])

  const plate = plates[index]
  if (!plate) return null

  return createPortal(
    <div className="submission-viewer" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="submission-viewer-inner" onClick={(event) => event.stopPropagation()}>
        <header>
          <strong>{plate.owner}</strong>
          {plate.verdict && <span className={`file-verdict is-${plate.verdict}`}>{verdictLabels[plate.verdict] || plate.verdict}</span>}
          {typeof plate.score === 'number' && <span className="upload-score">{plate.score} 分</span>}
          <span className="muted">{index + 1} / {plates.length}</span>
          <button aria-label="關閉" className="ghost-button icon-button" type="button" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="submission-viewer-stage">
          <button
            aria-label="上一份"
            className="ghost-button icon-button"
            disabled={plates.length < 2}
            type="button"
            onClick={() => onMove(-1)}
          >
            <ChevronLeft size={22} />
          </button>
          <img alt={plate.name} src={plate.url} />
          <button
            aria-label="下一份"
            className="ghost-button icon-button"
            disabled={plates.length < 2}
            type="button"
            onClick={() => onMove(1)}
          >
            <ChevronRight size={22} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
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

  const [zipping, setZipping] = useState(false)
  const [zipDone, setZipDone] = useState(0)
  const [zipError, setZipError] = useState('')
  const [viewing, setViewing] = useState<number | null>(null)

  const drawn = question.type === 'drawing'
  // Every readable page in the class, in the order they are listed, so the
  // arrows in the viewer walk the same sequence the presenter sees.
  const plates = useMemo<Plate[]>(() => submissions.flatMap((files, index) => files
    .filter((file) => isImageFileName(file.name, file.mime_type) && file.file_url)
    .map((file) => ({
      url: file.file_url as string,
      name: file.name,
      owner: anonymousEnabled ? `匿名作答 ${index + 1}` : file.participant_name,
      verdict: files[0].analysis_json?.verdict || '',
      score: typeof files[0].analysis_json?.score === 'number' ? files[0].analysis_json.score : null,
    }))), [anonymousEnabled, submissions])

  // One archive rather than a click per student. A class of thirty hands back
  // thirty-odd files and saving them one at a time is most of a break.
  async function downloadAll() {
    const wanted = submissions.flatMap((files, index) => files
      .filter((file) => file.file_url)
      .map((file) => ({ file, owner: anonymousEnabled ? `匿名作答 ${index + 1}` : file.participant_name })))
    if (!wanted.length) return
    setZipping(true)
    setZipDone(0)
    setZipError('')
    try {
      const taken = new Set<string>()
      const entries: ZipEntry[] = []
      // Sequentially, not Promise.all: thirty parallel fetches of photographs
      // is how a classroom wifi connection starts dropping them.
      for (const { file, owner } of wanted) {
        const response = await fetch(file.file_url as string)
        if (!response.ok) throw new Error(`${file.name}（${response.status}）`)
        const data = new Uint8Array(await response.arrayBuffer())
        entries.push({ name: uniqueName(taken, safeFileName(`${owner}-${file.name}`)), data })
        setZipDone((done) => done + 1)
      }
      const stamp = new Date().toISOString().slice(0, 10)
      const url = URL.createObjectURL(createZip(entries))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${safeFileName(question.prompt_text || question.title)}-${stamp}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      // Revoked late: Chromium reads the blob after the click returns.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (caught) {
      setZipError(caught instanceof Error ? `下載失敗：${caught.message}` : '下載失敗。')
    } finally {
      setZipping(false)
    }
  }

  const marked = submissions.filter((files) => files[0].analysis_status === 'success').length
  const totalFiles = submissions.reduce((sum, files) => sum + files.filter((file) => file.file_url).length, 0)

  if (!submissions.length) {
    return (
      <p className="muted">
        {drawn
          ? question.status === 'active' ? '還沒有學生送出作答。' : '這一題沒有收到任何作答。'
          : question.status === 'active' ? '還沒有學生上傳作答。' : '這一題沒有收到任何上傳。'}
      </p>
    )
  }

  return (
    <>
      <div className="upload-summary-row">
        <p className="muted">{drawn ? '已作答' : '已上傳'} {submissions.length} 人 · 已批改 {marked} 人</p>
        <button className="ghost-button" disabled={zipping} type="button" onClick={() => void downloadAll()}>
          {zipping ? <LoaderCircle className="spin" size={15} /> : <Download size={15} />}
          {zipping ? `打包中 ${zipDone} / ${totalFiles}` : `下載全部（${totalFiles} 個檔案）`}
        </button>
      </div>
      {zipError && <p className="error">{zipError}</p>}
      <ul className="file-list upload-answer-list">
        {submissions.map((files, index) => {
          const lead = files[0]
          const result = lead.analysis_json
          const verdict = result?.verdict || ''
          const busy = files.some((file) => fileBusyId === file.id || file.analysis_status === 'analyzing')
          const preview = files.find((file) => isImageFileName(file.name, file.mime_type) && file.file_url)
          const failure = files.find((file) => file.error_message && file.analysis_status !== 'success')
          return (
            <li key={lead.participant_id}>
              <div className="file-response-row">
                {preview ? (
                  <button
                    aria-label={`放大 ${anonymousEnabled ? `匿名作答 ${index + 1}` : lead.participant_name} 的作答`}
                    className="file-response-thumb-button"
                    type="button"
                    onClick={() => {
                      if (window.interactDesktop?.openSubmissionReview) {
                        void window.interactDesktop.openSubmissionReview(question.session_id, question.id)
                        return
                      }
                      const at = plates.findIndex((plate) => plate.url === preview.file_url)
                      // -1 would open the viewer on nothing; leaving it closed
                      // is at least honest about having nothing to show.
                      if (at >= 0) setViewing(at)
                    }}
                  >
                    <img alt={preview.name} className="file-response-thumb" src={preview.file_url} />
                    <Maximize2 size={14} />
                  </button>
                ) : (
                  <span className="file-response-thumb is-placeholder">
                    <FileTypeIcon mimeType={lead.mime_type} name={lead.name} size={24} />
                  </span>
                )}
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
      {viewing !== null && (
        <SubmissionViewer
          index={viewing}
          plates={plates}
          onClose={() => setViewing(null)}
          // Wraps rather than stopping: going past the last one lands on the
          // first, which is what a presenter flicking through a class expects.
          onMove={(delta) => setViewing((current) => (
            current === null ? null : (current + delta + plates.length) % plates.length
          ))}
        />
      )}
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
// The same drag the class gets. A teacher setting the answer is doing exactly
// what the students did, so it should not be a different control.
function OrderingKeyEditor({ items, current, busy, onSubmit }: {
  items: string[]
  current: string[]
  busy: boolean
  onSubmit: (values: string[]) => Promise<void>
}) {
  const [order, setOrder] = useState<string[]>(current.length ? current : items)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)

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
        <button className="ghost-button" disabled={busy} type="button" onClick={() => { setOrder(current.length ? current : items); setOpen(true) }}>
          {current.length ? '修改正確順序' : '改為有標準答案'}
        </button>
      </div>
    )
  }

  return (
    <div className="ordering-key-editor">
      <p className="muted">拖曳項目排出正確順序。</p>
      <SortableList disabled={busy || saving} values={order} onReorder={setOrder} />
      <div className="ordering-actions">
        <button disabled={busy || saving || unchanged} type="button" onClick={() => void save(order)}>
          <CheckCircle2 size={16} />送出答案
        </button>
        {current.length > 0 && (
          // Back to an open question. A key set by mistake otherwise leaves the
          // whole class marked wrong with no way out.
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
  const [picked, setPicked] = useState<string[]>(current)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const complete = picked.length === prompts.length && picked.every(Boolean)
  const unchanged = picked.every((value, index) => value === (current[index] || ''))

  if (!open) {
    return (
      <div className="ordering-key-set">
        <button className="ghost-button" disabled={busy} type="button" onClick={() => setOpen(true)}>{current.length ? '修改正確配對' : '設定正確配對'}</button>
      </div>
    )
  }

  return (
    <div className="ordering-key-editor">
      <p className="muted">把答案拖到它對應的題目上。</p>
      <MatchingBoard choices={choices} disabled={busy || saving} prompts={prompts} onChange={setPicked} />
      <div className="ordering-actions">
        <span className="muted">{picked.filter(Boolean).length} / {prompts.length}</span>
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
function OrderingMistakes({ answers, correctValues, sentenceMode }: { answers: Answer[]; correctValues: string[]; sentenceMode: boolean }) {
  const wrong = new Map<string, number>()
  for (const entry of answers) {
    const given = entry.answer_values || []
    if (given.length === correctValues.length && correctValues.every((value, index) => value === given[index])) continue
    const key = joinSequence(given, sentenceMode)
    if (key) wrong.set(key, (wrong.get(key) || 0) + 1)
  }
  const shared = [...wrong.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
  // Image tiles have no readable one-line form, and every answer is listed below.
  if (correctValues.some(isImageValue)) return null
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
// Slide rows to their new places instead of teleporting. The class's order
// changes every time an answer lands, and a list that silently rearranges
// between glances reads as a glitch — seeing a row travel is what makes it read
// as the class moving it. Measure where rows were, let React lay them out, then
// animate from the old position to the new one.
function useRankAnimation(listRef: RefObject<HTMLOListElement | null>, order: string) {
  const previous = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const next = new Map<string, number>()
    for (const row of [...list.children] as HTMLElement[]) {
      const key = row.dataset.rankKey
      if (!key) continue
      const top = row.offsetTop
      next.set(key, top)
      const before = previous.current.get(key)
      if (before === undefined || before === top) continue
      row.animate(
        [{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }],
        { duration: 320, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
      )
    }
    previous.current = next
  }, [listRef, order])
}

// A sequence read back across the line instead of down a list, so a sentence
// looks like the sentence it is meant to become.
function SequenceReadout({ values, sentenceMode }: { values: string[]; sentenceMode: boolean }) {
  // Tiles cut out of a screenshot: the presenter needs to see the pieces, not
  // the storage paths they happen to live at.
  if (values.some(isImageValue)) {
    return (
      <ol className="ordering-tiles">
        {values.map((value, index) => (
          <li key={value}><img alt={`第 ${index + 1} 塊`} src={value} /></li>
        ))}
      </ol>
    )
  }
  if (sentenceMode) {
    return <ul className="sentence-readout">{values.map((value) => <li key={value}>{value}</li>)}</ul>
  }
  return <ol className="ordering-consensus is-key">{values.map((value) => <li key={value}>{value}</li>)}</ol>
}

// What each student actually sent, which is the thing a teacher reads out loud
// when going over the answer. Marked questions carry a verdict; an open one just
// shows what they arranged.
function OrderingSubmissions({ answers, anonymousEnabled, marked, sentenceMode }: {
  answers: Answer[]
  anonymousEnabled: boolean
  marked: boolean
  sentenceMode: boolean
}) {
  if (!answers.length) return null
  return (
    <>
      <h3 className="ordering-subheading">學生的作答</h3>
      <ul className="ordering-submissions">
        {answers.map((entry, index) => {
          const values = entry.answer_values || []
          return (
            <li key={entry.id}>
              <div className="ordering-submission-head">
                <strong>{anonymousEnabled ? `匿名作答 ${index + 1}` : entry.participant_name}</strong>
                {marked && (
                  <span className={entry.is_correct ? 'file-verdict is-correct' : 'file-verdict is-wrong'}>
                    {entry.is_correct ? '答對' : '答錯'}
                  </span>
                )}
              </div>
              <SequenceReadout sentenceMode={sentenceMode} values={values} />
            </li>
          )
        })}
      </ul>
    </>
  )
}

function OrderingSpread({ items, answers }: { items: string[]; answers: Answer[] }) {
  // The class's answer, worked out by weight rather than shown as a table for
  // the presenter to work out themselves: each item is scored by the average
  // place it was given, and the list is that score in order. 同意度 is the share
  // who put it exactly where the class landed — high means the class agreed,
  // low means the item is where it is only because the disagreement cancelled out.
  const ranked = items
    .map((item) => {
      const places = answers
        .map((entry) => (entry.answer_values || []).indexOf(item))
        .filter((place) => place >= 0)
      const mean = places.length
        ? places.reduce((sum, place) => sum + place + 1, 0) / places.length
        : items.length + 1
      return { item, mean, places }
    })
    .sort((a, b) => a.mean - b.mean)
    .map((entry, index) => {
      const agreed = entry.places.filter((place) => place === index).length
      return {
        ...entry,
        agreement: entry.places.length ? Math.round((agreed / entry.places.length) * 100) : 0,
      }
    })

  const listRef = useRef<HTMLOListElement>(null)
  useRankAnimation(listRef, ranked.map((entry) => entry.item).join())

  return (
    <>
      <h3 className="ordering-subheading">平均排序結果</h3>
      <ol className="ordering-ranked" ref={listRef}>
        {ranked.map((entry, index) => (
          <li data-rank-key={entry.item} key={entry.item}>
            {isImageValue(entry.item)
              ? <img alt={`第 ${index + 1} 個區塊`} className="ordering-ranked-image" src={entry.item} />
              : <span className="ordering-ranked-item">{entry.item}</span>}
            {/* How solid this placing is, in words a teacher can read out. The
                average rank decided the order but is not worth saying aloud, and
                with one answer in, every item is trivially unanimous. */}
            {answers.length > 1 && (
              <span
                className={`ordering-agreement is-${entry.agreement === 100 ? 'firm' : entry.agreement >= 60 ? 'most' : 'split'}`}
                title={`${entry.places.length} 人中有 ${Math.round(entry.agreement * entry.places.length / 100)} 人排在第 ${index + 1}`}
              >
                {entry.agreement === 100 ? '全班一致' : entry.agreement >= 60 ? '多數這樣排' : '意見分歧'}
              </span>
            )}
          </li>
        ))}
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

// Its own component so the enlarge state is a hook on the branch that uses it
// rather than one on the dispatcher, which returns early for half the types.
function HotspotResults(props: Props & { question: Question }) {
  const { anonymousEnabled, answers, question, screenshotUrl } = props
  const [expanded, setExpanded] = useState(false)

  // Every tap the class made, back on the picture they were looking at. The
  // reading a presenter wants is not how many were wrong but where they all
  // went — eighteen pins in one place is the next thing to explain.
  const current = answers.filter((entry) => entry.round === question.answer_round)
  const pins = current.flatMap((entry, index) => parsePins(entry.answer_values).map((point) => ({
    ...point,
    label: pinLabel(entry.participant_name, anonymousEnabled, index),
    color: pinColor(entry.participant_id),
  })))

  // The panel is a column beside the class list, so the picture in it is a
  // thumbnail. Same gesture as 自訂測驗: a real window in the desktop app, a
  // full-screen overlay everywhere else.
  function enlarge() {
    if (window.interactDesktop) {
      void window.interactDesktop.openHotspotReview(question.session_id, question.id)
      return
    }
    setExpanded(true)
  }

  return (
    <section className="panel result-panel hotspot-results-panel">
      <div className="panel-heading">
        <h2>{question.title}</h2>
        <span className="hotspot-heading-actions">
          {screenshotUrl && (
            <button aria-label="放大檢視點選結果" className="icon-button" title="放大檢視點選結果" type="button" onClick={enlarge}>
              <Maximize2 size={20} />
            </button>
          )}
          <QuestionStatusActions {...props} question={question} />
        </span>
      </div>
      {question.prompt_text && <p className="detected-question">{question.prompt_text}</p>}
      <p className="muted">
        已作答 {current.length} 人 · 共 {pins.length} 個標記
        {question.max_pins && question.max_pins > 1 ? `（每人最多 ${question.max_pins} 個）` : ''}
        {question.answer_round > 1 ? ` · 第 ${question.answer_round} 輪` : ''}
      </p>
      {screenshotUrl
        ? (
          <button className="hotspot-thumb-button" title="放大檢視點選結果" type="button" onClick={enlarge}>
            <HotspotImage alt="學生點選結果" imageUrl={screenshotUrl} pins={pins} />
          </button>
        )
        : <p className="muted">找不到這一題的截圖。</p>}
      {expanded && screenshotUrl && createPortal(
        <div className="custom-quiz-review-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExpanded(false) }}>
          <section aria-label="圖上點選放大檢視" aria-modal="true" className="hotspot-review-modal" role="dialog">
            <header>
              <h2>{question.prompt_text || question.title}</h2>
              <button aria-label="關閉放大視窗" className="icon-button" title="關閉" type="button" onClick={() => setExpanded(false)}><X size={22} /></button>
            </header>
            <div className="hotspot-review-stage">
              <HotspotImage alt="學生點選結果" imageUrl={screenshotUrl} pins={pins} />
            </div>
          </section>
        </div>,
        document.body,
      )}
    </section>
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

  if (question.type === 'board') return <BoardResults {...props} question={question} />

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

  if (question.type === 'file_upload' || question.type === 'drawing') {
    return (
      <>
        <section className="panel result-panel upload-results-panel">
          <div className="panel-heading">
            <h2>{question.type === 'drawing' ? <PencilLine size={20} /> : <FileUp size={20} />}{question.title}</h2>
            <span className="hotspot-heading-actions">
              {window.interactDesktop?.openSubmissionReview && props.fileResponses.some((item) => item.question_id === question.id) && (
                <button
                  aria-label="放大檢視學生作答"
                  className="icon-button"
                  title="放大檢視學生作答"
                  type="button"
                  onClick={() => void window.interactDesktop?.openSubmissionReview(question.session_id, question.id)}
                >
                  <Maximize2 size={20} />
                </button>
              )}
              <QuestionStatusActions {...props} question={question} />
            </span>
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
    const key = props.orderingKey || []
    const keyKnown = props.orderingKey !== null
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
            {/* Silent until the answer has loaded: saying 沒有標準答案 to a question
                that has one, for as long as the fetch takes, is worse than saying
                nothing for a moment. */}
            {!keyKnown ? '' : marked ? ` · 答對 ${correct} 人（${rate}%）` : ' · 這一題沒有標準答案'}
          </p>
          {keyKnown && marked && (
            <>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${rate}%` }} /></div>
              <h3 className="ordering-subheading">{question.type === 'ordering' ? '正確順序' : '正確配對'}</h3>
              {question.type === 'ordering'
                ? <SequenceReadout sentenceMode={question.sentence_mode} values={key} />
                : <MatchingBreakdown answers={roundAnswers} correctValues={key} prompts={question.options} />}
              {question.type === 'ordering' && <OrderingMistakes answers={roundAnswers} correctValues={key} sentenceMode={question.sentence_mode} />}
            </>
          )}
          {/* Without a key there is nothing to be right about, so the panel shows
              what the class thought instead of how many missed it. */}
          {keyKnown && !marked && question.type === 'ordering' && <OrderingSpread answers={roundAnswers} items={question.options} />}
          {keyKnown && !marked && question.type === 'matching' && (
            <MatchingBreakdown answers={roundAnswers} correctValues={[]} prompts={question.options} />
          )}
          {/* The presenter chose 沒有標準答案 when they dispatched this, so the
              panel does not hand them a 送出答案 form contradicting that. */}
          {keyKnown && (question.type === 'ordering'
            ? <OrderingKeyEditor busy={props.busy} current={key} items={question.options} onSubmit={props.onSetOrderingKey} />
            : <MatchingKeyEditor busy={props.busy} choices={question.choices} current={key} prompts={question.options} onSubmit={props.onSetOrderingKey} />)}
          {question.type === 'ordering' && (
            <OrderingSubmissions answers={roundAnswers} anonymousEnabled={anonymousEnabled} marked={marked} sentenceMode={question.sentence_mode} />
          )}
        </section>
        <RoundComparison answers={answers} correctAnswers={[]} question={question} />
      </>
    )
  }

  if (question.type === 'hotspot') return <HotspotResults {...props} question={question} />

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

// The wall as it appears beside the class list. Its own component so the
// polling and the reveal state are hooks on the branch that uses them rather
// than on the dispatcher, which returns early for a dozen other types.
function BoardResults(props: Props & { question: Question }) {
  const { question } = props
  const [snapshot, setSnapshot] = useState<BoardSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  // Polled rather than subscribed: the presenter's copy comes through the edge
  // function on the service role, because before the reveal the table is
  // closed even to them through the ordinary client, and realtime obeys the
  // same policy. Ten seconds is well inside the pace a teacher reads a wall at.
  useEffect(() => {
    let live = true
    const read = async () => {
      try {
        const next = await loadBoard(question.session_id, question.id)
        if (live) {
          setSnapshot(next)
          setError('')
        }
      } catch (caught) {
        if (live) setError(caught instanceof Error ? caught.message : '讀取討論板失敗。')
      }
    }
    void read()
    const timer = window.setInterval(() => void read(), 10_000)
    return () => { live = false; window.clearInterval(timer) }
  }, [question.id, question.session_id])

  const live = snapshot?.question
  const revealed = Boolean(live?.board_revealed_at ?? question.board_revealed_at)
  const open = (live?.status ?? question.status) === 'active'
  const formats = (live?.board_formats ?? question.board_formats ?? []) as BoardPostKind[]
  const maxPosts = live?.board_max_posts ?? question.board_max_posts
  const cards = (snapshot?.posts || []).filter((post) => !post.reply_to)
  const contributors = new Set(cards.filter((post) => !post.deleted_at).map((post) => post.participant_id)).size

  async function run(body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      await boardAction(question.session_id, body)
      setSnapshot(await loadBoard(question.session_id, question.id))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失敗。')
    } finally {
      setBusy(false)
    }
  }

  function enlarge() {
    if (!window.interactDesktop?.openBoardReview) return
    window.interactDesktop.openBoardReview(question.session_id, question.id)
      .catch((caught: unknown) => {
        setError(`放大檢視開啟失敗：${caught instanceof Error ? caught.message : '請稍後再試。'}`)
      })
  }

  return (
    <>
    <section className="panel result-panel board-results-panel">
      <div className="panel-heading">
        <h2>{question.title}</h2>
        <span className="hotspot-heading-actions">
          {window.interactDesktop?.openBoardReview && (
            <button aria-label="放大檢視討論板" className="icon-button" title="放大檢視討論板" type="button" onClick={enlarge}>
              <Maximize2 size={20} />
            </button>
          )}
          <span className={`status ${question.status}`}>{question.status}</span>
        </span>
      </div>
      {question.prompt_text && <p className="detected-question">{question.prompt_text}</p>}
      <p className="muted">
        {cards.filter((post) => !post.deleted_at).length} 則 · {contributors} 人
        {maxPosts === null ? ' · 每人不限' : ` · 每人上限 ${maxPosts} 則`}
      </p>
      {error && <p className="error">{error}</p>}

      <div className="board-results-actions">
        {/* Both ways. A presenter may want the class to think alone and then
            look together, or to share from the start and then close the wall
            again to settle the room. */}
        <button
          className="ghost-button"
          disabled={busy}
          type="button"
          onClick={() => void run({ action: 'set_board_visibility', questionId: question.id, shared: !revealed })}
        >
          {revealed ? <><EyeOff size={16} />自行作答</> : <><Eye size={16} />開放瀏覽</>}
        </button>
        <button
          className="ghost-button"
          disabled={busy}
          type="button"
          onClick={() => void run({ action: 'set_board_open', questionId: question.id, open: !open })}
        >
          {open ? <><SquareX size={16} />結束討論</> : <><RotateCcw size={16} />恢復討論</>}
        </button>
        <button className="ghost-button" disabled={busy} type="button" onClick={() => setEditing((current) => !current)}>
          <Settings2 size={16} />調整題型
        </button>
      </div>
      {editing && (
        <div className="board-settings">
          {/* A discussion that has started is exactly when a presenter finds
              out that words were not enough, or that one card each was too
              few. Changing either does not disturb what is already up. */}
          <div className="board-format-grid">
            {BOARD_FORMAT_LABELS.map(([kind, label]) => {
              const on = formats.includes(kind)
              return (
                <button
                  aria-pressed={on}
                  className={`board-format-chip${on ? ' is-selected' : ''}`}
                  disabled={busy}
                  key={kind}
                  type="button"
                  onClick={() => {
                    const next = on ? formats.filter((item) => item !== kind) : [...formats, kind]
                    if (!next.length) return
                    void run({ action: 'update_board_settings', questionId: question.id, boardFormats: next })
                  }}
                >
                  <strong>{label}</strong>
                </button>
              )
            })}
          </div>
          <TimingRow
            formatValue={(value: number) => `${value} 則`}
            label="每人可貼"
            offLabel="∞"
            presets={[1, 2, 3, 5, null]}
            value={maxPosts}
            onChange={(value: number | null) => void run({ action: 'update_board_settings', questionId: question.id, boardMaxPosts: value })}
          />
        </div>
      )}
      {!revealed && <p className="muted">學生現在只看得到自己貼的。</p>}
      {!open && <p className="muted">已結束討論：學生看得到整面牆，也還能按心情，但不能再貼或回覆。</p>}

      <BoardWall
        anonymous={Boolean(snapshot?.posts.some((post) => post.anonymous_at_display))}
        busy={busy}
        posts={snapshot?.posts || []}
        reactions={snapshot?.reactions || []}
        onSetState={(postId, patch) => void run({ action: 'set_board_post_state', postId, ...patch })}
      />
      </section>
      {/* Counted from what the class can actually see: a card its author took
          back, or one taken down, is not part of the discussion to analyse. */}
      <AiAnalysisPanel
        {...props}
        boardCardCount={cards.filter((post) => !post.deleted_at && !post.hidden_at).length}
      />
    </>
  )
}
