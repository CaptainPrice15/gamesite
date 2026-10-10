import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getGame } from '../games/registry'
import { GameHost } from '../ui/GameHost'
import { FriendMatch } from '../ui/FriendMatch'
import { ErrorBoundary } from '../core/errorBoundary'
import { trackEvent } from '../lib/analytics'

export function GamePage(): ReactNode {
  const { gameId } = useParams<{ gameId: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const game = getGame(gameId)
  const inviteCode = searchParams.get('room')
  const [view, setView] = useState<'game' | 'friend'>(
    inviteCode && game?.online ? 'friend' : 'game',
  )

  useEffect(() => {
    if (game) trackEvent('game-open', { game: game.id })
  }, [game])

  const exit = useCallback(() => navigate('/'), [navigate])
  const openFriend = useCallback(() => setView('friend'), [])
  const closeFriend = useCallback(() => setView('game'), [])

  if (!game) {
    return (
      <div className="page">
        <div className="fallback">
          <h2>Unknown game</h2>
          <p className="muted">“{gameId}” isn’t in the arcade.</p>
          <button className="btn primary" onClick={exit}>
            Back to arcade
          </button>
        </div>
      </div>
    )
  }

  if (view === 'friend' && game.online) {
    return (
      <ErrorBoundary key={`friend-${game.id}`} label={game.title} onReset={closeFriend}>
        <FriendMatch game={game} initialCode={inviteCode} onExit={closeFriend} />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary key={game.id} label={game.title} onReset={exit}>
      <GameHost game={game} onExit={exit} onFriendMatch={game.online ? openFriend : undefined} />
    </ErrorBoundary>
  )
}
