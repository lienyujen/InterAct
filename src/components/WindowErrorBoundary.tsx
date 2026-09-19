import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { message: string }

// A detail window opens with the presenter's controls hidden behind it, so a
// page that throws while rendering does not leave a broken window — it leaves
// the presenter with no window at all, mid-class, and looks exactly like the
// application crashing.
//
// React unmounts the whole tree when a render throws, which is what produced
// the blank window. This catches it, says what happened, and keeps the way out
// on screen. It is a class because that is the only way to catch a render
// error in React.
export class WindowErrorBoundary extends Component<Props, State> {
  state: State = { message: '' }

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Goes to the main process log, where it is readable after the fact.
    console.error('window render failed', error.message, info.componentStack)
  }

  render() {
    if (!this.state.message) return this.props.children
    return (
      <main className="window-error">
        <h1>這個視窗出了問題</h1>
        <p className="muted">課堂沒有中斷，關掉這個視窗就會回到原來的畫面。</p>
        <pre>{this.state.message}</pre>
        <button type="button" onClick={() => window.interactDesktop?.close()}>關閉視窗</button>
      </main>
    )
  }
}
