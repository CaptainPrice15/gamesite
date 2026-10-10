import { Suspense, lazy, useEffect, type ReactNode } from 'react'
import { BrowserRouter, Link, Route, Routes } from 'react-router-dom'
import { NavBar } from './ui/NavBar'
import { HomePage } from './pages/HomePage'
import { ErrorBoundary } from './core/errorBoundary'
import { SettingsProvider } from './core/settings'
import { ProfileProvider } from './lib/auth'
import { ProfileGate } from './ui/ProfileGate'
import { initTheme } from './core/theme'

const GamePage = lazy(() => import('./pages/GamePage').then((m) => ({ default: m.GamePage })))
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)
const LeaderboardPage = lazy(() =>
  import('./pages/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })),
)
const HistoryPage = lazy(() =>
  import('./pages/HistoryPage').then((m) => ({ default: m.HistoryPage })),
)
const LegalPage = lazy(() => import('./pages/LegalPage').then((m) => ({ default: m.LegalPage })))

initTheme()

export default function App(): ReactNode {
  useEffect(() => {
    document.title = 'Arcade — Browser Games'
  }, [])

  return (
    <SettingsProvider>
      <ProfileProvider>
        <BrowserRouter>
          <div className="app">
            <a className="skip-link" href="#main">
              Skip to content
            </a>
            <NavBar />
            <main id="main">
              <ErrorBoundary label="Page">
                <Suspense
                  fallback={
                    <div className="page">
                      <p className="muted">Loading…</p>
                    </div>
                  }
                >
                  <Routes>
                    <Route path="/" element={<HomePage />} />
                    <Route path="/play/:gameId" element={<GamePage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/leaderboard/:gameId?" element={<LeaderboardPage />} />
                    <Route path="/history" element={<HistoryPage />} />
                    <Route path="/privacy" element={<LegalPage kind="privacy" />} />
                    <Route path="/terms" element={<LegalPage kind="terms" />} />
                    <Route
                      path="*"
                      element={
                        <div className="page">
                          <div className="fallback">
                            <h2>404 — lost in the maze</h2>
                            <a className="btn primary" href="/">
                              Back to arcade
                            </a>
                          </div>
                        </div>
                      }
                    />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </main>
            <footer className="site-footer">
              <span>Free browser arcade — no ads, no accounts required.</span>
              <nav aria-label="Legal">
                <Link to="/privacy">Privacy</Link>
                <Link to="/terms">Terms</Link>
              </nav>
            </footer>
            <ProfileGate />
          </div>
        </BrowserRouter>
      </ProfileProvider>
    </SettingsProvider>
  )
}
