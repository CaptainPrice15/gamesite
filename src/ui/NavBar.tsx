import { Link, NavLink } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { resolveTheme, subscribeTheme, toggleTheme, type ResolvedTheme } from '../core/theme'
import { useProfile } from '../lib/auth'
import { EditNameButton } from './ProfileGate'

export function NavBar(): React.ReactNode {
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolveTheme())
  const { profile } = useProfile()

  useEffect(() => subscribeTheme(setTheme), [])

  return (
    <header className="navbar">
      <Link to="/" className="brand" aria-label="Arcade home">
        <span className="brand-mark" aria-hidden="true">
          ▚
        </span>
        <span>Arcade</span>
      </Link>

      <nav aria-label="Main">
        <NavLink to="/" end>
          Games
        </NavLink>
        <NavLink to="/leaderboard/snake">Leaderboard</NavLink>
        <NavLink to="/history">Matches</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>

      {profile && (
        <span className="elo-chip" title="Your rating">
          <span className="elo-label" aria-hidden="true">
            ELO
          </span>
          {profile.elo}
        </span>
      )}

      <EditNameButton />

      <button
        className="icon-btn"
        onClick={() => setTheme(toggleTheme())}
        aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
        title="Toggle theme"
      >
        {theme === 'dark' ? '☾' : '☀'}
      </button>
    </header>
  )
}
