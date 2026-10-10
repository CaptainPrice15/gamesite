import { useState, type ReactNode } from 'react'
import type { GameModule } from '../core/types'
import { supabase } from '../lib/supabase'
import { isValidRoomCode } from '../shared/roomCode'
import type { QueueMode } from '../net/useQueue'

interface ModeSelectProps {
  game: GameModule
  busy: boolean
  onCreate(): void
  onJoin(code: string): void
  onLocal(): void
  onQueue?(mode: QueueMode): void
}

function normalizeCode(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 6)
}

export function ModeSelect({
  game,
  busy,
  onCreate,
  onJoin,
  onLocal,
  onQueue,
}: ModeSelectProps): ReactNode {
  const [code, setCode] = useState('')
  const [queueMode, setQueueMode] = useState<QueueMode>('ranked')
  const clean = normalizeCode(code)
  const canJoin = isValidRoomCode(clean) && !busy

  return (
    <div className="page narrow friend-page">
      <h1>{game.title}</h1>
      <p className="muted">Find a random opponent, or room up with a friend.</p>

      {!supabase && (
        <p className="friend-note">Online play needs a connection — local play still works.</p>
      )}

      <div className="col gap friend-actions">
        {onQueue && (
          <div className="queue-block">
            <div className="seg" role="group" aria-label="Match type">
              <button
                type="button"
                aria-pressed={queueMode === 'ranked'}
                onClick={() => setQueueMode('ranked')}
              >
                Ranked
              </button>
              <button
                type="button"
                aria-pressed={queueMode === 'casual'}
                onClick={() => setQueueMode('casual')}
              >
                Casual
              </button>
            </div>
            <button
              className="btn primary"
              onClick={() => onQueue(queueMode)}
              disabled={busy || !supabase}
              aria-busy={busy}
            >
              Find a random opponent
            </button>
            <p className="field-hint">
              {queueMode === 'ranked'
                ? 'Ranked wins move your rating — matchmaking by skill.'
                : 'Casual keeps your rating untouched.'}
            </p>
          </div>
        )}

        <button className="btn" onClick={onCreate} disabled={busy || !supabase} aria-busy={busy}>
          Create a room
        </button>

        <div className="join-row">
          <input
            className="code-input"
            value={code}
            onChange={(event) => setCode(normalizeCode(event.target.value))}
            placeholder="ROOM CODE"
            aria-label="Room code"
            maxLength={6}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn" onClick={() => onJoin(clean)} disabled={!canJoin}>
            Join
          </button>
        </div>

        <button className="btn ghost" onClick={onLocal} disabled={busy}>
          Play locally instead
        </button>
      </div>

      {busy && <p className="muted">Connecting…</p>}
    </div>
  )
}
