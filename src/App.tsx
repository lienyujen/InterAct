import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { DesktopWindowChrome } from './components/DesktopWindowChrome'
import { ErrorBoundary } from './ErrorBoundary'
import { DesktopOverlayPage } from './routes/DesktopOverlayPage'
import { CustomQuizReviewPage } from './routes/CustomQuizReviewPage'
import { HomePage } from './routes/HomePage'
import { JoinPage } from './routes/JoinPage'
import { ParticipantPage } from './routes/ParticipantPage'
import { PresenterNewPage } from './routes/PresenterNewPage'
import { PresenterPage } from './routes/PresenterPage'
import { SessionReportPage } from './routes/SessionReportPage'
import { WordCloudPage } from './routes/WordCloudPage'
import { useSessionReportBack } from './lib/sessionReportNavigation'

function AppRoutes() {
  const location = useLocation()
  const returnFromSessionReport = useSessionReportBack()
  const isDesktop = Boolean(window.interactDesktop)
  const isDesktopOverlay = location.pathname.startsWith('/desktop-overlay/')
  const isCustomQuizReview = location.pathname.startsWith('/custom-quiz-review/')
  const isDesktopPresenter = isDesktop && location.pathname.startsWith('/presenter/') && location.pathname !== '/presenter/new'
  const isSessionReport = location.pathname.startsWith('/session-report/')
  const isWordCloud = location.pathname.startsWith('/word-cloud/')

  return (
    <div className={isDesktop ? 'desktop-shell' : undefined}>
      {!isDesktopOverlay && !isDesktopPresenter && !isCustomQuizReview && (
        <DesktopWindowChrome
          confirmClose={!isWordCloud}
          onBack={isSessionReport ? returnFromSessionReport : undefined}
        />
      )}
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/presenter/new" element={isDesktop ? <PresenterNewPage /> : <Navigate to="/" replace />} />
        <Route path="/presenter/:sessionId" element={isDesktop ? <PresenterPage /> : <Navigate to="/" replace />} />
        <Route path="/desktop-overlay/:sessionId" element={isDesktop ? <DesktopOverlayPage /> : <Navigate to="/" replace />} />
        <Route path="/custom-quiz-review/:sessionId/:questionId" element={isDesktop ? <CustomQuizReviewPage /> : <Navigate to="/" replace />} />
        <Route path="/session-report/:sessionId" element={isDesktop ? <SessionReportPage /> : <Navigate to="/" replace />} />
        <Route path="/word-cloud/:sessionId" element={isDesktop ? <WordCloudPage /> : <Navigate to="/" replace />} />
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
      <ErrorBoundary>
        <AppRoutes />
      </ErrorBoundary>
    </HashRouter>
  )
}

export default App
