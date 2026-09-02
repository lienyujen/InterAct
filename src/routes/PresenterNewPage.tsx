import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, DoorClosed, FileChartColumn, ListRestart, LoaderCircle, Settings, LogIn, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { SetupNotice } from '../components/SetupNotice'
import { BackendSetup } from '../components/BackendSetup'
import { getPresenterToken, savePresenterToken } from '../lib/presenterAuth'
import { deleteManagedSession, endManagedSession, listManagedSessions } from '../lib/presenterSessions'
import type { ManagedSession } from '../lib/presenterSessions'
import { isSupabaseConfigured, requireSupabase } from '../lib/supabase'

async function getFunctionErrorMessage(error: unknown) {
  if (!(error instanceof Error)) return '建立場次失敗'

  const response = (error as Error & { context?: Response }).context
  if (!response) return error.message

  try {
    const body = await response.clone().json()
    if (typeof body?.message === 'string') return body.message
  } catch {
    // Fall back to the SDK message when the response is not JSON.
  }

  return error.message
}

export function PresenterNewPage() {
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [managementOpen, setManagementOpen] = useState(false)
  const [systemSetupOpen, setSystemSetupOpen] = useState(false)
  const [managementBusy, setManagementBusy] = useState(false)
  const [managementError, setManagementError] = useState('')
  const [managementNotice, setManagementNotice] = useState('')
  const [managedSessions, setManagedSessions] = useState<ManagedSession[]>([])
  const [pendingAction, setPendingAction] = useState<{ type: 'end' | 'delete'; session: ManagedSession } | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const activeSessions = useMemo(() => managedSessions.filter((session) => session.status === 'active'), [managedSessions])
  const endedSessions = useMemo(() => managedSessions.filter((session) => session.status === 'ended'), [managedSessions])

  async function createSession(event: FormEvent) {
    event.preventDefault()
    setError('')
    if (!isSupabaseConfigured) {
      setError('請先設定 Supabase。')
      return
    }

    setBusy(true)
    try {
      const { data, error: createError } = await requireSupabase().functions.invoke('create-session', {
        body: {
          title: title.trim() || '未命名場次',
        },
        headers: { 'x-interact-client': 'windows-app' },
      })

      if (createError) throw createError
      if (!data?.sessionId || !data?.presenterToken) throw new Error('建立場次時沒有取得講者權限。')
      savePresenterToken(data.sessionId, data.presenterToken)
      navigate(`/presenter/${data.sessionId}`)
    } catch (err) {
      setError(await getFunctionErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  async function loadManagedSessions() {
    setManagementBusy(true)
    setManagementError('')
    try {
      setManagedSessions(await listManagedSessions())
    } catch (err) {
      setManagementError(err instanceof Error ? err.message : '無法讀取場次清單。')
    } finally {
      setManagementBusy(false)
    }
  }

  async function openManagement() {
    setManagementOpen(true)
    setManagementNotice('')
    await loadManagedSessions()
  }

  useEffect(() => {
    const routeState = location.state as { openSessionManager?: boolean } | null
    if (!routeState?.openSessionManager) return

    navigate('/presenter/new', { replace: true, state: null })
    void openManagement()
  }, [location.state, navigate])

  function rejoinSession(session: ManagedSession) {
    if (session.status !== 'active') return
    navigate(`/presenter/${session.id}`)
  }

  async function runPendingAction() {
    if (!pendingAction) return
    const presenterToken = getPresenterToken(pendingAction.session.id)
    if (!presenterToken) {
      setPendingAction(null)
      setManagementError('找不到這個場次的講者權限。')
      return
    }

    setManagementBusy(true)
    setManagementError('')
    setManagementNotice('')
    try {
      if (pendingAction.type === 'delete') {
        await deleteManagedSession(pendingAction.session.id, presenterToken)
        setManagementNotice(`已永久移除「${pendingAction.session.title}」。`)
      } else {
        await endManagedSession(pendingAction.session.id, presenterToken)
        setManagementNotice(`已關閉「${pendingAction.session.title}」，課堂資料仍會保留，且不會產生 AI 課程總結。`)
      }
      setPendingAction(null)
      setManagedSessions(await listManagedSessions())
    } catch (err) {
      setManagementError(err instanceof Error ? err.message : '場次操作失敗。')
    } finally {
      setManagementBusy(false)
    }
  }

  function sessionRow(session: ManagedSession) {
    return (
      <article className="managed-session-item" key={session.id}>
        <div className="managed-session-meta">
          <div>
            <h3>{session.title}</h3>
            <span className={`status ${session.status}`}>{session.status === 'active' ? '進行中' : '已關閉'}</span>
          </div>
          <p>場次碼 {session.code} · {new Date(session.created_at).toLocaleString('zh-TW')}</p>
        </div>
        <div className="managed-session-actions">
          {session.status === 'active' ? (
            <>
              <button type="button" onClick={() => rejoinSession(session)} disabled={managementBusy}>
                <LogIn size={17} />重新加入場次
              </button>
              <button className="ghost-button" type="button" onClick={() => setPendingAction({ type: 'end', session })} disabled={managementBusy}>
                <DoorClosed size={17} />關閉場次
              </button>
            </>
          ) : (
            <button type="button" onClick={() => navigate(`/session-report/${session.id}`)} disabled={managementBusy}>
              <FileChartColumn size={17} />檢視課堂報告
            </button>
          )}
          <button className="danger-ghost-button" type="button" onClick={() => setPendingAction({ type: 'delete', session })} disabled={managementBusy}>
            <Trash2 size={17} />移除場次
          </button>
        </div>
      </article>
    )
  }

  return (
    <main className="center-page presenter-new-page">
      <SetupNotice />
      <form className="panel form-panel" onSubmit={createSession}>
        <span className="form-heading-icon"><Sparkles size={24} /></span>
        <h1>建立新場次</h1>
        <p className="muted">建立場次，讓學生掃碼即可加入</p>
        <label>
          場次名稱
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：AI 教學工作坊" />
        </label>
        {error && <p className="error">{error}</p>}
        <button disabled={busy} type="submit">
          {busy ? '建立中...' : '建立場次'}
          {!busy && <ArrowRight size={18} />}
        </button>
        <button className="ghost-button manage-sessions-button" disabled={busy} type="button" onClick={openManagement}>
          <ListRestart size={18} />管理場次
        </button>
        <button className="ghost-button manage-sessions-button" disabled={busy} type="button" onClick={() => setSystemSetupOpen(true)}>
          <Settings size={18} />系統設定
        </button>
        <p className="app-credit">
          <a href="https://github.com/lienyujen/InterAct/blob/main/LICENSE" rel="noreferrer" target="_blank">InterAct</a>
          {' | Designed and Developed by '}
          <a href="https://www.facebook.com/lienyujen/" rel="noreferrer" target="_blank">Yujen Lien</a>
        </p>
      </form>
      {/* Reachable after setup too, so keys can be added or the project changed
          without having to clear the configuration first. */}
      {systemSetupOpen && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal system-setup-modal" role="dialog" aria-modal="true" aria-label="系統設定">
            <BackendSetup onCancel={() => setSystemSetupOpen(false)} />
          </div>
        </div>
      )}
      {managementOpen && (
        <div className="modal-backdrop" role="presentation">
          <section aria-labelledby="manage-sessions-title" aria-modal="true" className="modal session-manager-modal" role="dialog">
            <div className="modal-heading">
              <div>
                <p className="eyebrow">InterAct</p>
                <h2 id="manage-sessions-title">管理場次</h2>
              </div>
              <div className="session-manager-heading-actions">
                <button aria-label="重新整理" className="icon-button ghost-button" disabled={managementBusy} title="重新整理" type="button" onClick={loadManagedSessions}>
                  <RefreshCw className={managementBusy ? 'spin' : undefined} size={18} />
                </button>
                <button aria-label="關閉管理場次" className="icon-button ghost-button" disabled={managementBusy} type="button" onClick={() => setManagementOpen(false)}>
                  <X size={18} />
                </button>
              </div>
            </div>
            {managementError && <p className="error">{managementError}</p>}
            {managementNotice && <p className="success">{managementNotice}</p>}
            {managementBusy && !managedSessions.length ? (
              <div className="session-manager-loading"><LoaderCircle className="spin" size={24} />讀取場次中...</div>
            ) : (
              <div className="session-manager-content">
                <section>
                  <h3>尚未結束 <span>{activeSessions.length}</span></h3>
                  <div className="managed-session-list">
                    {activeSessions.length ? activeSessions.map(sessionRow) : <p className="muted">目前沒有進行中的場次。</p>}
                  </div>
                </section>
                {endedSessions.length > 0 && (
                  <section>
                    <h3>已關閉 <span>{endedSessions.length}</span></h3>
                    <div className="managed-session-list">{endedSessions.map(sessionRow)}</div>
                  </section>
                )}
              </div>
            )}
          </section>
        </div>
      )}
      <ConfirmDialog
        busy={managementBusy}
        confirmLabel={pendingAction?.type === 'delete' ? '永久移除' : '關閉場次'}
        description={pendingAction?.type === 'delete'
          ? `「${pendingAction?.session.title || ''}」的學員、訊息、題目、作答、派送、分析與截圖都會永久刪除，無法復原。`
          : `「${pendingAction?.session.title || ''}」將停止互動，學員會看到課程已結束；課堂資料與派送內容會保留，但不會產生 AI 課程總結。`}
        open={Boolean(pendingAction)}
        title={pendingAction?.type === 'delete' ? '確定永久移除場次？' : '確定關閉場次？'}
        onCancel={() => {
          if (!managementBusy) setPendingAction(null)
        }}
        onConfirm={runPendingAction}
      />
    </main>
  )
}
