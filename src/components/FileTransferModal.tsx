import { useCallback, useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Download, FileUp, FolderUp, LoaderCircle, Send, Sparkles, Square, Trash2, Upload, X } from 'lucide-react'
import { downloadHref } from '../lib/fileLinks'
import type { FileResponse, Question, SharedFile } from '../types'

type Tab = 'share' | 'collect'

type Props = {
  busy: boolean
  sharedFiles: SharedFile[]
  collectQuestion: Question | null
  fileResponses: FileResponse[]
  onClose: () => void
  onShareFiles: (files: File[]) => Promise<void>
  onDeleteSharedFile: (fileId: string) => Promise<void>
  onStartCollect: (promptText: string) => Promise<void>
  onStopCollect: () => Promise<void>
  onRefreshResponses: () => Promise<void>
  onAnalyzeResponse: (responseId: string) => Promise<void>
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function isImage(mimeType: string, name: string) {
  return mimeType.startsWith('image/') || /\.(png|jpe?g|webp|gif|heic|heif)$/i.test(name)
}

const analysisLabels: Record<FileResponse['analysis_status'], string> = {
  pending: '尚未分析',
  analyzing: '分析中...',
  success: '已分析',
  failed: '分析失敗',
  unsupported: 'AI 無法讀取此格式',
}

export function FileTransferModal({
  busy,
  sharedFiles,
  collectQuestion,
  fileResponses,
  onClose,
  onShareFiles,
  onDeleteSharedFile,
  onStartCollect,
  onStopCollect,
  onRefreshResponses,
  onAnalyzeResponse,
}: Props) {
  const [tab, setTab] = useState<Tab>('share')
  const [dragging, setDragging] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [expanded, setExpanded] = useState<string>('')
  const inputRef = useRef<HTMLInputElement>(null)

  const collecting = collectQuestion?.status === 'active'

  useEffect(() => {
    if (tab !== 'collect' || !collectQuestion) return
    void onRefreshResponses()
  }, [collectQuestion, onRefreshResponses, tab])

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    setUploading(true)
    setError('')
    try {
      await onShareFiles(files)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '檔案上傳失敗。')
    } finally {
      setUploading(false)
    }
  }, [onShareFiles])

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setDragging(false)
    void handleFiles(Array.from(event.dataTransfer.files))
  }

  async function guard(run: () => Promise<void>) {
    setError('')
    try {
      await run()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失敗。')
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section aria-labelledby="file-transfer-title" aria-modal="true" className="modal file-transfer-modal" role="dialog">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">InterAct</p>
            <h2 id="file-transfer-title">檔案傳送</h2>
          </div>
          <button aria-label="關閉檔案傳送" className="icon-button ghost-button" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="file-transfer-tabs">
          <button className={tab === 'share' ? 'is-active' : ''} type="button" onClick={() => setTab('share')}>
            <FolderUp size={16} />教師檔案分享
          </button>
          <button className={tab === 'collect' ? 'is-active' : ''} type="button" onClick={() => setTab('collect')}>
            <FileUp size={16} />學生檔案上傳
          </button>
        </div>

        {error && <p className="error">{error}</p>}

        {tab === 'share' ? (
          <div className="file-transfer-body">
            <p className="muted">拖曳檔案到下方，或點選選擇檔案。上傳後學生端會立刻出現檔名與下載連結。</p>
            <div
              className={`file-dropzone${dragging ? ' is-dragging' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => inputRef.current?.click()}
              onDragLeave={() => setDragging(false)}
              onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
              onDrop={onDrop}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click() }}
            >
              {uploading ? <LoaderCircle className="spin" size={26} /> : <Upload size={26} />}
              <strong>{uploading ? '上傳中...' : '拖曳檔案到這裡'}</strong>
              <span className="muted">或點選這個區塊從檔案總管選擇，可一次選多個</span>
            </div>
            <input
              hidden
              multiple
              ref={inputRef}
              type="file"
              onChange={(event) => {
                void handleFiles(Array.from(event.target.files || []))
                event.target.value = ''
              }}
            />

            <h3>已分享 <span>{sharedFiles.length}</span></h3>
            {sharedFiles.length ? (
              <ul className="file-list">
                {sharedFiles.map((file) => (
                  <li key={file.id}>
                    <div className="file-list-meta">
                      <strong>{file.name}</strong>
                      <span className="muted">{formatSize(file.file_size)}</span>
                    </div>
                    <div className="file-list-actions">
                      {file.file_url && (
                        <a className="ghost-button" href={downloadHref(file.file_url, file.name)} rel="noreferrer" target="_blank">
                          <Download size={15} />開啟
                        </a>
                      )}
                      <button
                        className="danger-ghost-button"
                        disabled={busy}
                        type="button"
                        onClick={() => void guard(() => onDeleteSharedFile(file.id))}
                      >
                        <Trash2 size={15} />移除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">還沒有分享任何檔案。</p>}
          </div>
        ) : (
          <div className="file-transfer-body">
            <p className="muted">派送後學生端會出現上傳按鈕，可傳文件與圖片。停止收件後可逐檔送 AI 分析。</p>
            <label>
              題目（選填）
              <textarea
                disabled={collecting}
                placeholder="例如：請上傳你這週的專題進度截圖"
                rows={2}
                value={collecting ? collectQuestion?.prompt_text || '' : prompt}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <div className="file-transfer-controls">
              {collecting ? (
                <button disabled={busy} type="button" onClick={() => void guard(onStopCollect)}>
                  <Square size={16} />停止收件
                </button>
              ) : (
                <button disabled={busy} type="button" onClick={() => void guard(() => onStartCollect(prompt))}>
                  <Send size={16} />派送上傳功能
                </button>
              )}
              {collectQuestion && (
                <button className="ghost-button" disabled={busy} type="button" onClick={() => void guard(onRefreshResponses)}>
                  <LoaderCircle size={16} />重新整理
                </button>
              )}
            </div>

            {collectQuestion && (
              <>
                <h3>學生回傳 <span>{fileResponses.length}</span></h3>
                {fileResponses.length ? (
                  <ul className="file-list">
                    {fileResponses.map((response) => (
                      <li key={response.id}>
                        <div className="file-response-row">
                          {isImage(response.mime_type, response.name) && response.file_url ? (
                            <a href={response.file_url} rel="noreferrer" target="_blank">
                              <img alt={response.name} className="file-response-thumb" src={response.file_url} />
                            </a>
                          ) : <span className="file-response-thumb is-placeholder"><FileUp size={18} /></span>}
                          <div className="file-list-meta">
                            <strong>{response.participant_name}</strong>
                            <span className="muted">{response.name} · {formatSize(response.file_size)}</span>
                            <span className={`file-analysis-status is-${response.analysis_status}`}>
                              {analysisLabels[response.analysis_status]}
                            </span>
                          </div>
                          <div className="file-list-actions">
                            {response.file_url && (
                              <a className="ghost-button" href={downloadHref(response.file_url, response.name)} rel="noreferrer" target="_blank">
                                <Download size={15} />下載
                              </a>
                            )}
                            {!collecting && ['pending', 'failed'].includes(response.analysis_status) && (
                              <button
                                disabled={busy}
                                type="button"
                                onClick={() => void guard(() => onAnalyzeResponse(response.id))}
                              >
                                <Sparkles size={15} />AI 分析
                              </button>
                            )}
                            {response.analysis_status === 'success' && (
                              <button
                                className="ghost-button"
                                type="button"
                                onClick={() => setExpanded(expanded === response.id ? '' : response.id)}
                              >
                                {expanded === response.id ? '收合' : '看分析'}
                              </button>
                            )}
                          </div>
                        </div>
                        {response.error_message && response.analysis_status !== 'success' && (
                          <p className="muted file-analysis-error">{response.error_message}</p>
                        )}
                        {expanded === response.id && response.analysis_json && (
                          <div className="file-analysis-detail">
                            <p>{response.analysis_json.summary_zh_tw}</p>
                            {response.analysis_json.strengths_zh_tw.length > 0 && (
                              <>
                                <h4>做得好</h4>
                                <ul>{response.analysis_json.strengths_zh_tw.map((item, index) => <li key={index}>{item}</li>)}</ul>
                              </>
                            )}
                            {response.analysis_json.improvements_zh_tw.length > 0 && (
                              <>
                                <h4>可改進</h4>
                                <ul>{response.analysis_json.improvements_zh_tw.map((item, index) => <li key={index}>{item}</li>)}</ul>
                              </>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : <p className="muted">還沒有學生上傳檔案。</p>}
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
