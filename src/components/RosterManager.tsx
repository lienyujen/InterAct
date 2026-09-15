import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ClipboardPaste, FileUp, Plus, Save, Trash2, Users, X } from 'lucide-react'
import {
  deleteRoster,
  duplicateNames,
  getSessionRosterId,
  listRosters,
  newEntry,
  newRoster,
  normalizeName,
  parsePastedNames,
  saveRoster,
  setSessionRosterId,
} from '../lib/classRoster'
import { guessColumns, readRosterTable } from '../lib/rosterImport'
import type { ClassRoster, RosterEntry } from '../lib/classRoster'
import type { Table } from '../lib/rosterImport'

type Props = {
  sessionId: string
  open: boolean
  onClose: () => void
  // The window re-reads the roster after any change rather than being handed it,
  // so there is one place that decides what the current list is.
  onChanged: () => void
}

type ColumnChoice = { name: number; studentNo: number; unit: number }

// Class lists live on this computer, not in the database, so this whole dialog
// talks to localStorage. A university teacher reuses the same list every week;
// the session only records which one it is using.
export function RosterManager({ sessionId, open, onClose, onChanged }: Props) {
  const [rosters, setRosters] = useState<ClassRoster[]>([])
  const [editing, setEditing] = useState<ClassRoster | null>(null)
  const [table, setTable] = useState<Table | null>(null)
  const [columns, setColumns] = useState<ColumnChoice>({ name: -1, studentNo: -1, unit: -1 })
  const [pasting, setPasting] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const appliedId = getSessionRosterId(sessionId)

  useEffect(() => {
    if (open) refresh()
  }, [open])

  function refresh() {
    setRosters(listRosters())
  }

  function openEditor(roster: ClassRoster) {
    setEditing(roster)
    setTable(null)
    setPasting(false)
    setPasteText('')
    setError('')
  }

  function backToList() {
    setEditing(null)
    setTable(null)
    setPasting(false)
    setError('')
    refresh()
  }

  function apply(rosterId: string | null) {
    setSessionRosterId(sessionId, rosterId)
    onChanged()
    refresh()
  }

  async function pickFile(file: File | null, hasHeader: boolean) {
    if (!file) return
    setError('')
    try {
      const parsed = await readRosterTable(file, hasHeader)
      if (!parsed.rows.length) throw new Error('這個檔案裡沒有資料。')
      setTable(parsed)
      const guessed = guessColumns(parsed.headers)
      // Falling back to the first column matters more than it looks: a list with
      // no header at all is one column of names, and asking the presenter to
      // pick it would be asking a question with one possible answer.
      setColumns({ ...guessed, name: guessed.name >= 0 ? guessed.name : 0 })
    } catch (caught) {
      setTable(null)
      setError(caught instanceof Error ? caught.message : '無法讀取這個檔案。')
    }
  }

  function importRows(replace: boolean) {
    if (!editing || !table || columns.name < 0) return
    const imported = table.rows
      .map((row) => newEntry(
        row[columns.name] || '',
        columns.studentNo >= 0 ? row[columns.studentNo] || '' : '',
        columns.unit >= 0 ? row[columns.unit] || '' : '',
      ))
      .filter((entry) => entry.name)
    if (!imported.length) {
      setError('選到的欄位裡沒有姓名，換一欄再試。')
      return
    }
    setEditing({ ...editing, entries: replace ? imported : [...editing.entries, ...imported] })
    setTable(null)
    setError('')
  }

  function applyPaste(replace: boolean) {
    if (!editing) return
    const pasted = parsePastedNames(pasteText)
    if (!pasted.length) {
      setError('沒有讀到任何姓名。')
      return
    }
    setEditing({ ...editing, entries: replace ? pasted : [...editing.entries, ...pasted] })
    setPasting(false)
    setPasteText('')
    setError('')
  }

  function updateEntry(id: string, patch: Partial<RosterEntry>) {
    if (!editing) return
    setEditing({
      ...editing,
      entries: editing.entries.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry)),
    })
  }

  function save() {
    if (!editing) return
    const cleaned = editing.entries.filter((entry) => entry.name.trim())
    const saved = saveRoster({ ...editing, name: editing.name.trim() || '未命名名單', entries: cleaned })
    // Saving the list a session is already using should take effect there at
    // once, rather than after the presenter remembers to apply it again.
    if (appliedId === saved.id) onChanged()
    backToList()
  }

  const duplicates = useMemo(
    () => (editing ? duplicateNames(editing.entries) : new Set<string>()),
    [editing],
  )

  if (!open) return null

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section aria-label="學員名單" aria-modal="true" className="modal roster-manager" role="dialog">
        <header className="roster-manager-head">
          {editing
            ? (
              <button className="icon-button" title="回到名單清單" type="button" onClick={backToList}>
                <ArrowLeft size={18} />
              </button>
            )
            : <Users size={18} />}
          <h2>{editing ? '編輯名單' : '學員名單'}</h2>
          <button aria-label="關閉" className="icon-button" title="關閉" type="button" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        {error && <p className="error">{error}</p>}

        {!editing && (
          <>
            <p className="muted roster-manager-hint">
              名單存在這台電腦上，不會上傳。學員仍然自己輸入姓名 —— 對得上的顯示綠色勾，對不上的照樣加入，名單上那位就算未到。
            </p>
            <div className="roster-manager-actions">
              <button type="button" onClick={() => openEditor(newRoster(''))}>
                <Plus size={16} />建立新名單
              </button>
              {appliedId && (
                <button className="ghost-button" type="button" onClick={() => apply(null)}>
                  停用這場的名單
                </button>
              )}
            </div>
            {rosters.length ? (
              <ul className="roster-manager-list">
                {rosters.map((roster) => (
                  <li key={roster.id}>
                    <div className="roster-manager-item">
                      <strong>{roster.name}</strong>
                      <span className="muted">{roster.entries.length} 人</span>
                      {appliedId === roster.id && <span className="roster-manager-applied">使用中</span>}
                    </div>
                    <div className="roster-manager-item-actions">
                      {appliedId !== roster.id && (
                        <button className="ghost-button" type="button" onClick={() => apply(roster.id)}>套用</button>
                      )}
                      <button className="ghost-button" type="button" onClick={() => openEditor(roster)}>編輯</button>
                      <button
                        aria-label={`刪除 ${roster.name}`}
                        className="icon-button"
                        title="刪除這份名單"
                        type="button"
                        onClick={() => {
                          deleteRoster(roster.id)
                          if (appliedId === roster.id) apply(null)
                          refresh()
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="muted">還沒有任何名單。</p>}
          </>
        )}

        {editing && (
          <>
            <label className="roster-manager-name">
              名單名稱
              <input
                placeholder="例如：114-1 資訊概論"
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
              />
            </label>

            <div className="roster-manager-actions">
              <input
                accept=".csv,.xlsx"
                hidden
                ref={fileRef}
                type="file"
                onChange={(event) => {
                  void pickFile(event.target.files?.[0] || null, true)
                  event.target.value = ''
                }}
              />
              <button className="ghost-button" type="button" onClick={() => fileRef.current?.click()}>
                <FileUp size={16} />匯入 CSV / Excel
              </button>
              <button className="ghost-button" type="button" onClick={() => { setPasting(true); setTable(null) }}>
                <ClipboardPaste size={16} />貼上姓名
              </button>
              <button className="ghost-button" type="button" onClick={() => setEditing({ ...editing, entries: [...editing.entries, newEntry()] })}>
                <Plus size={16} />加一列
              </button>
            </div>

            {pasting && (
              <div className="roster-manager-paste">
                <textarea
                  placeholder={'一行一個名字，用逗號或頓號分隔也可以'}
                  rows={6}
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                />
                <div className="roster-manager-actions">
                  <button type="button" onClick={() => applyPaste(true)}>取代現有名單</button>
                  <button className="ghost-button" type="button" onClick={() => applyPaste(false)}>加到後面</button>
                  <button className="ghost-button" type="button" onClick={() => { setPasting(false); setPasteText('') }}>取消</button>
                </div>
              </div>
            )}

            {table && (
              <div className="roster-manager-mapping">
                <p className="muted">選擇每個欄位對應到檔案裡的哪一欄。</p>
                <div className="roster-manager-columns">
                  {([
                    ['name', '姓名', true],
                    ['studentNo', '學號', false],
                    ['unit', '系所 / 單位', false],
                  ] as Array<[keyof ColumnChoice, string, boolean]>).map(([key, label, required]) => (
                    <label key={key}>
                      {label}{required ? '（必選）' : ''}
                      <select
                        value={columns[key]}
                        onChange={(event) => setColumns({ ...columns, [key]: Number(event.target.value) })}
                      >
                        {!required && <option value={-1}>不匯入</option>}
                        {table.headers.map((header, index) => (
                          <option key={`${index}-${header}`} value={index}>{header}</option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                <p className="muted">
                  讀到 {table.rows.length} 列。預覽：{table.rows.slice(0, 3).map((row) => row[columns.name] || '（空白）').join('、')}
                </p>
                <div className="roster-manager-actions">
                  <button type="button" onClick={() => importRows(true)}>取代現有名單</button>
                  <button className="ghost-button" type="button" onClick={() => importRows(false)}>加到後面</button>
                  <button className="ghost-button" type="button" onClick={() => setTable(null)}>取消</button>
                </div>
              </div>
            )}

            {duplicates.size > 0 && (
              <p className="roster-manager-warning">
                名單上有同名的人，光靠姓名分不出來。請替他們填上學號。
              </p>
            )}

            <ol className="roster-manager-entries">
              {editing.entries.map((entry, index) => (
                <li className={duplicates.has(normalizeName(entry.name)) ? 'is-duplicate' : ''} key={entry.id}>
                  <span className="roster-manager-index">{index + 1}</span>
                  <input
                    aria-label="姓名"
                    placeholder="姓名"
                    value={entry.name}
                    onChange={(event) => updateEntry(entry.id, { name: event.target.value })}
                  />
                  <input
                    aria-label="學號"
                    placeholder="學號"
                    value={entry.studentNo}
                    onChange={(event) => updateEntry(entry.id, { studentNo: event.target.value })}
                  />
                  <input
                    aria-label="系所或單位"
                    placeholder="系所"
                    value={entry.unit}
                    onChange={(event) => updateEntry(entry.id, { unit: event.target.value })}
                  />
                  <button
                    aria-label={`刪除第 ${index + 1} 列`}
                    className="icon-button"
                    title="刪除這一列"
                    type="button"
                    onClick={() => setEditing({ ...editing, entries: editing.entries.filter((item) => item.id !== entry.id) })}
                  >
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ol>
            {!editing.entries.length && <p className="muted">還沒有任何人。匯入檔案、貼上姓名，或按「加一列」自己輸入。</p>}

            <div className="roster-manager-actions roster-manager-footer">
              <span className="muted">{editing.entries.filter((entry) => entry.name.trim()).length} 人</span>
              <button type="button" onClick={save}><Save size={16} />儲存名單</button>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
