import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DesktopWindowChrome } from './components/DesktopWindowChrome'
import { DesktopOverlayPage } from './routes/DesktopOverlayPage'
import { HomePage } from './routes/HomePage'
import { JoinPage } from './routes/JoinPage'
import { ParticipantPage } from './routes/ParticipantPage'
import { PresenterNewPage } from './routes/PresenterNewPage'
import { PresenterPage } from './routes/PresenterPage'
import { SessionReportPage } from './routes/SessionReportPage'

function AppRoutes() {
  const location = useLocation()
  const isDesktopOverlay = location.pathname.startsWith('/desktop-overlay/')
  const isDesktopPresenter = window.interactDesktop && location.pathname.startsWith('/presenter/') && location.pathname !== '/presenter/new'

  return (
    <div className={window.interactDesktop ? 'desktop-shell' : undefined}>
      {!isDesktopOverlay && !isDesktopPresenter && <DesktopWindowChrome />}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/presenter/new" element={<PresenterNewPage />} />
        <Route path="/presenter/:sessionId" element={<PresenterPage />} />
        <Route path="/desktop-overlay/:sessionId" element={<DesktopOverlayPage />} />
        <Route path="/session-report/:sessionId" element={<SessionReportPage />} />
        <Route path="/join/:sessionId" element={<JoinPage />} />
        <Route path="/participant/:sessionId" element={<ParticipantPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}

export function App() {
  return (
    <HashRouter>
      <AppRoutes />
    </HashRouter>
  )
}

export default App
