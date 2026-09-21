import { useCallback, useEffect, useState } from 'react'
import { ArrowDownUp, Shuffle, X } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { OrderingMistakes, OrderingSpread, OrderingSubmissions, SequenceReadout } from '../components/OrderingResults'
import { getPresenterToken } from '../lib/presenterAuth'
import { requireSupabase } from '../lib/supabase'
import type { Answer, Question } from '../types'

// A 排序題 cut out of a screenshot hands back pieces of that screenshot, and in
// the results column — a few hundred pixels wide — a piece is a sliver nobody
// can read. The panel keeps them small on purpose, because the panel has to
// hold the whole question; this is where they get the room to be read.
export function OrderingReviewPage() {
  const { sessionId = '', questionId = '' } = useParams()
  const [question, setQuestion] = useState<Question | null>(null)
  const [answers, setAnswers] = useState<Answer[]>([])
  const [correctValues, setCorrectValues] = useState<string[] | null>(null)
  const [anonymous, setAnonymous] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const presenterToken = getPresenterToken(sessionId)
    if (!presenterToken) {
      setError('找不到講者權限，請關閉視窗後重新開啟。')
      return
    }
    const supabase = requireSupabase()
    const [{ data: questionRow }, { data: answerRows }, { data: keyData }] = await Promise.all([
      supabase.from('questions').select('*').eq('id', questionId).maybeSingle(),
      supabase.from('answers').select('*').eq('question_id', questionId).order('submitted_at'),
      supabase.functions.invoke('presenter-action', {
        body: { action: 'get_ordering_key', sessionId, presenterToken, questionId },
      }),
    ])
    if (!questionRow) {
      setError('找不到這一題。')
      return
    }
    setQuestion(questionRow as Question)
    setAnswers((answerRows || []) as Answer[])
    setCorrectValues((keyData?.correctValues || []) as string[])
    setError('')
  }, [questionId, sessionId])

  useEffect(() => {
    void load()
    // The class keeps answering while this is open.
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [load])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void window.interactDesktop?.close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const matching = question?.type === 'matching'
  const round = question ? answers.filter((entry) => entry.round === question.answer_round) : []
  const key = correctValues || []
  const marked = key.length > 0
  const correct = round.filter((entry) => entry.is_correct === true).length
  const rate = round.length ? Math.round((correct / round.length) * 100) : 0

  return (
    <main className="ordering-review-window">
      <header>
        <div>
          <p className="eyebrow">{matching ? <Shuffle size={17} /> : <ArrowDownUp size={17} />}{matching ? '配對題檢視' : '排序題檢視'}</p>
          <h1>{question?.prompt_text || question?.title || '排序題'}</h1>
        </div>
        <label className="show-answers-toggle">
          <input checked={anonymous} type="checkbox" onChange={(event) => setAnonymous(event.target.checked)} />
          匿名顯示
        </label>
        <button aria-label="關閉檢視視窗" className="icon-button" title="關閉" type="button" onClick={() => void window.interactDesktop?.close()}>
          <X size={24} />
        </button>
      </header>

      {error && <p className="error">{error}</p>}

      {question && (
        <div className="ordering-review-body">
          <p className="muted">
            已作答 {round.length} 人{question.answer_round > 1 ? `（第 ${question.answer_round} 輪）` : ''}
            {correctValues === null ? '' : marked ? ` · 答對 ${correct} 人（${rate}%）` : ' · 這一題沒有標準答案'}
          </p>
          {marked && (
            <>
              <div className="bar-track"><div className="bar-fill" style={{ width: `${rate}%` }} /></div>
              <h3 className="ordering-subheading">正確順序</h3>
              <SequenceReadout sentenceMode={question.sentence_mode} values={key} />
              <OrderingMistakes answers={round} correctValues={key} sentenceMode={question.sentence_mode} />
            </>
          )}
          {correctValues !== null && !marked && <OrderingSpread answers={round} items={question.options} />}
          <OrderingSubmissions
            answers={round}
            anonymousEnabled={anonymous}
            marked={marked}
            sentenceMode={question.sentence_mode}
          />
        </div>
      )}
    </main>
  )
}
