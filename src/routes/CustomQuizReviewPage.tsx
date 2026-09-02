import { useCallback, useEffect, useState } from 'react'
import { BrainCircuit, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { QuizAnswerEditor } from '../components/CustomQuizResult'
import type { QuizReviewProps } from '../components/CustomQuizResult'
import { getPresenterToken } from '../lib/presenterAuth'
import { requireSupabase } from '../lib/supabase'
import type { PresenterQuizResults } from '../types'

async function functionErrorMessage(error: unknown, fallback: string) {
  const context = (error as { context?: Response } | null)?.context
  if (context) {
    try {
      const payload = await context.clone().json() as { message?: unknown }
      if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
    } catch {
      // Use the SDK message when the response body is not JSON.
    }
  }
  return error instanceof Error && error.message ? error.message : fallback
}

export function CustomQuizReviewPage() {
  const { sessionId = '', questionId = '' } = useParams()
  const [results, setResults] = useState<PresenterQuizResults | null>(null)
  const [busyItemId, setBusyItemId] = useState('')
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({})
  const [showAnswers, setShowAnswers] = useState(false)
  const [error, setError] = useState('')

  const loadQuiz = useCallback(async () => {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setError('找不到講者權限，請關閉視窗後重新開啟。')
      return
    }
    const { data, error: loadError } = await requireSupabase().functions.invoke('presenter-action', {
      body: { action: 'get_custom_quiz_results', sessionId, presenterToken, questionId },
    })
    if (loadError) {
      setError(await functionErrorMessage(loadError, '無法載入自訂測驗。'))
      return
    }
    setResults((data as PresenterQuizResults | null) || null)
    setError('')
  }, [questionId, sessionId])

  useEffect(() => {
    void loadQuiz()
    const timer = window.setInterval(() => void loadQuiz(), 2500)
    return () => window.clearInterval(timer)
  }, [loadQuiz])

  async function updateAnswer(itemId: string, acceptedAnswers: string[]) {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) throw new Error('找不到講者權限。')
    setBusyItemId(itemId)
    setError('')
    try {
      const { data, error: updateError } = await requireSupabase().functions.invoke('presenter-action', {
        body: {
          action: 'update_custom_quiz_key',
          sessionId,
          presenterToken,
          questionId,
          itemId,
          acceptedAnswers,
        },
      })
      if (updateError) throw new Error(await functionErrorMessage(updateError, '正確答案更新失敗。'))
      if (!data?.success) throw new Error(data?.message || '正確答案更新失敗。')
      await loadQuiz()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '正確答案更新失敗。')
    } finally {
      setBusyItemId('')
    }
  }

  const reviewProps: QuizReviewProps | null = results ? {
    busyItemId,
    draftAnswers,
    results,
    onDraftChange: (itemId, value) => setDraftAnswers((current) => ({ ...current, [itemId]: value })),
    onUpdateAnswer: updateAnswer,
    showAnswers,
  } : null

  return (
    <main className="custom-quiz-native-page">
      <header>
        <div>
          <p className="eyebrow"><BrainCircuit size={18} />自訂測驗檢視與答案調整</p>
          <h1>{results?.quiz?.title || (results ? 'AI 正在出題中，請稍候...' : '正在載入自訂測驗...')}</h1>
        </div>
        <button aria-label="關閉測驗檢視視窗" className="icon-button" title="關閉" type="button" onClick={() => window.interactDesktop?.close()}><X size={24} /></button>
      </header>
      {error && <p className="error custom-quiz-native-error">{error}</p>}
      {results && reviewProps ? (
        <div className={`custom-quiz-native-content${results.screenshot ? '' : ' is-single'}`}>
          {/* A file-sourced quiz has no screenshot; keeping the panel would leave
              half the window empty for the questions to squeeze beside. */}
          {results.screenshot && (
            <aside className="custom-quiz-source-panel">
              <h2>原始截圖</h2>
              <img alt="自訂測驗原始截圖" src={results.screenshot.public_url} />
            </aside>
          )}
          <section className="custom-quiz-question-panel">
            <h2>題目與正確答案</h2>
            <label className="show-answers-toggle">
              <input checked={showAnswers} type="checkbox" onChange={(event) => setShowAnswers(event.target.checked)} />
              顯示正確答案，若 AI 錯判答案請自行更正
            </label>
            <QuizAnswerEditor {...reviewProps} />
          </section>
        </div>
      ) : !error ? <p className="muted custom-quiz-native-loading">正在載入題目與截圖...</p> : null}
    </main>
  )
}
