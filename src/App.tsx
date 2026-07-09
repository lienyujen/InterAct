import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from './routes/HomePage'
import { JoinPage } from './routes/JoinPage'
import { ParticipantPage } from './routes/ParticipantPage'
import { PresenterNewPage } from './routes/PresenterNewPage'
import { PresenterPage } from './routes/PresenterPage'

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/presenter/new" element={<PresenterNewPage />} />
        <Route path="/presenter/:sessionId" element={<PresenterPage />} />
        <Route path="/join/:sessionId" element={<JoinPage />} />
        <Route path="/participant/:sessionId" element={<ParticipantPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
