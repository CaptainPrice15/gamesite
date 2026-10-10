import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { GameModule } from '../core/types'
import { useProfile } from '../lib/auth'
import type { RoomPhase } from '../net/useRoom'
import type { PresenceMember } from '../net/presence'
import type { QueueMode } from '../net/useQueue'

interface LobbyProps {
  game: GameModule
  code: string | null
  role: 'p1' | 'p2' | null
  phase: RoomPhase
  attempt: number
  error: string | null
  myReady: boolean
  bothReady: boolean
  started: boolean
  opponent: PresenceMember | null
  opponentPresent: boolean
  variant?: 'friend' | 'queue'
  queueMode?: QueueMode
  onToggleReady(): void
  onStart(): void
  onLeave(): void
}

export function Lobby({
  game,
  code,
  role,
  phase,
  attempt,
  error,
  myReady,
  bothReady,
  started,
  opponent,
  opponentPresent,
  variant = 'friend',
  queueMode = 'ranked',
  onToggleReady,
  onStart,
  onLeave,
}: LobbyProps): ReactNode {
  const { profile } = useProfile()
  const [copied, setCopied] = useState<'link' | 'code' | null>(null)

  useEffect(() => {
    if (copied === null) return
    const timer = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  const inviteLink = code ? `${window.location.origin}/play/${game.id}?room=${code}` : ''

  const copyLink = useCallback(() => {
    if (!inviteLink) return
    void navigator.clipboard?.writeText(inviteLink).then(() => setCopied('link'))
  }, [inviteLink])

  const copyCode = useCallback(() => {
    if (!code) return
    void navigator.clipboard?.writeText(code).then(() => setCopied('code'))
  }, [code])

  const myName = profile?.display_name ?? 'You'
  const isQueue = variant === 'queue'
  const kicker = isQueue
    ? queueMode === 'ranked'
      ? 'Ranked match'
      : 'Casual match'
    : 'Friend match'
  const statusLine =
    phase === 'connecting'
      ? 'Joining the match…'
      : error
        ? null
        : !opponentPresent
          ? 'Waiting for your opponent…'
          : isQueue
            ? started
              ? 'Starting…'
              : 'Opponent found — starting the match…'
            : bothReady
              ? 'Both players ready.'
              : 'Ready up when you are set.'

  return (
    <div className="page narrow friend-page">
      <h1>{game.title}</h1>
      <p className="friend-kicker">{kicker}</p>

      {phase === 'connecting' && <p className="muted">{statusLine}</p>}

      {attempt > 0 && phase !== 'error' && (
        <p className="friend-note">Reconnecting — attempt {attempt}…</p>
      )}

      {phase === 'error' && (
        <div className="friend-error" role="alert">
          <p>{error ?? 'Connection lost.'}</p>
          <button className="btn" onClick={onLeave}>
            Back
          </button>
        </div>
      )}

      {!isQueue && (
        <div className="lobby-code-card">
          <span className="lobby-label">Room code</span>
          <strong className="lobby-code" aria-label={code ? `Room code ${code}` : 'Room code'}>
            {code ?? '······'}
          </strong>
          <div className="row gap lobby-copy">
            <button className="btn" onClick={copyLink} disabled={!code}>
              {copied === 'link' ? 'Link copied!' : 'Copy invite link'}
            </button>
            <button className="btn ghost" onClick={copyCode} disabled={!code}>
              {copied === 'code' ? 'Copied!' : 'Copy code'}
            </button>
          </div>
          <p className="field-hint">Send the link — your friend lands straight in this room.</p>
        </div>
      )}

      <div className="lobby-players">
        <div className="lobby-player">
          <span className="lobby-name">
            {myName}
            {role === 'p1' && <span className="lobby-host">host</span>}
            <span className="lobby-you">you</span>
          </span>
          <span className={`lobby-ready ${myReady ? 'on' : ''}`}>
            {myReady ? 'Ready' : 'Not ready'}
          </span>
        </div>
        <div className="lobby-player">
          <span className="lobby-name">
            {opponentPresent && opponent ? opponent.name : 'Waiting for opponent…'}
          </span>
          <span className={`lobby-ready ${opponent?.ready ? 'on' : ''}`}>
            {!opponentPresent ? '—' : opponent?.ready ? 'Ready' : 'Not ready'}
          </span>
        </div>
      </div>

      {phase === 'lobby' && <p className="muted">{statusLine}</p>}

      {phase === 'lobby' && isQueue && (
        <div className="col gap friend-actions">
          {!opponentPresent && <p className="muted">Your opponent is reconnecting…</p>}
          <button className="btn ghost" onClick={onLeave}>
            Leave queue match
          </button>
        </div>
      )}

      {phase === 'lobby' && !isQueue && (
        <div className="col gap friend-actions">
          <button
            className={`btn ${myReady ? '' : 'primary'}`}
            onClick={onToggleReady}
            aria-pressed={myReady}
          >
            {myReady ? 'I am not ready' : 'I am ready'}
          </button>

          {role === 'p1' && bothReady && !started && (
            <button className="btn primary" onClick={onStart}>
              Start match
            </button>
          )}
          {role === 'p1' && !bothReady && (
            <p className="muted">You start the match once both players are ready.</p>
          )}
          {role === 'p2' && bothReady && !started && (
            <p className="muted">Waiting for the host to start the match…</p>
          )}

          <button className="btn ghost" onClick={onLeave}>
            Leave room
          </button>
        </div>
      )}
    </div>
  )
}
