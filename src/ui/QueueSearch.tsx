import type { ReactNode } from 'react'
import type { GameModule } from '../core/types'
import type { QueueMode, QueuePhase } from '../net/useQueue'

interface QueueSearchProps {
  game: GameModule
  mode: QueueMode
  phase: QueuePhase
  elapsedSec: number
  cooldownSec: number
  error: string | null
  rating: number | null
  onCancel(): void
}

export function QueueSearch({
  game,
  mode,
  elapsedSec,
  cooldownSec,
  error,
  rating,
  onCancel,
  phase,
}: QueueSearchProps): ReactNode {
  const searching = phase === 'searching'
  const minutes = Math.floor(elapsedSec / 60)
  const seconds = elapsedSec % 60
  const clock = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`

  return (
    <div className="page narrow friend-page">
      <h1>{game.title}</h1>
      <p className="friend-kicker">{mode === 'ranked' ? 'Ranked match' : 'Casual match'}</p>

      {phase === 'cooldown' && (
        <div className="friend-error" role="alert">
          <p>You left too many queues — search again in {cooldownSec}s.</p>
        </div>
      )}

      {error && (
        <div className="friend-error" role="alert">
          <p>{error}</p>
          <button className="btn" onClick={onCancel}>
            Back
          </button>
        </div>
      )}

      {searching && (
        <div className="queue-status" role="status" aria-live="polite">
          <span className="queue-pulse" aria-hidden="true" />
          <p className="queue-line">
            Finding an opponent… <span className="queue-clock">{clock}</span>
          </p>
          <p className="muted queue-note">
            The skill window widens the longer you wait — usually under a minute.
          </p>
        </div>
      )}

      {phase === 'idle' && !error && (
        <p className="muted">Search cancelled — pick a mode to jump back in.</p>
      )}

      {rating !== null && mode === 'ranked' && (
        <p className="queue-rating">
          Your rating <strong>{rating}</strong>
        </p>
      )}
      {mode === 'casual' && <p className="muted">Casual games never change your rating.</p>}

      <div className="col gap friend-actions">
        <button
          className="btn"
          onClick={onCancel}
          disabled={phase === 'matched'}
          aria-busy={searching}
        >
          {searching ? 'Cancel search' : 'Back'}
        </button>
      </div>
    </div>
  )
}
