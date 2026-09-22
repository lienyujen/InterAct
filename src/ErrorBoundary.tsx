import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { error: Error | null; where: string }

// The component the error came from, read off the top of React's stack. A
// crash in a frameless window used to leave nothing but a one-line message on
// screen and no way to open devtools, so the only evidence was a photograph of
// it — which says what broke but never where.
function topFrame(componentStack: string | null | undefined) {
  const first = (componentStack || '').split('\n').map((line) => line.trim()).filter(Boolean)[0]
  return first ? first.replace(/^at\s+/, '') : ''
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, where: '' }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const where = topFrame(info.componentStack)
    this.setState({ where })
    console.error('[render-crash]', error.stack || error.message, info.componentStack)
    // Written to disk as well, because the console of a frameless window is
    // not something a teacher can open in the middle of a lesson.
    void window.interactDesktop?.logDiagnostic?.({
      event: 'render_crash',
      route: window.location.hash || window.location.pathname,
      message: error.message,
      where,
      stack: (error.stack || '').slice(0, 2000),
      componentStack: (info.componentStack || '').slice(0, 2000),
    })
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ background: '#fff', color: '#c0392b', padding: 16, fontSize: 13, fontFamily: 'monospace' }}>
          <p>畫面發生錯誤：{this.state.error.message}</p>
          {this.state.where && <p>發生在：{this.state.where}</p>}
          <p style={{ color: '#687386' }}>{window.location.hash || window.location.pathname}</p>
        </div>
      )
    }
    return this.props.children
  }
}
