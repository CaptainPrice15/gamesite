import { useEffect, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { GAMES, getGame } from '../games/registry'
import { supabase } from '../lib/supabase'
import { useProfile } from '../lib/auth'
import { isGameId } from '../shared/scoreRules'
import '../styles/online.css'

interface LeaderRow {
  rank: number
  user_id: string
  display_name: string
  score: number
  created_at: string
}

type LoadState = 'loading' | 'ready' | 'error'

function toCount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return null
}

function toRow(value: unknown): LeaderRow | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  const rank = toCount(raw.rank)
  const score = toCount(raw.score)
  if (rank === null || score === null) return null
  if (typeof raw.user_id !== 'string' || typeof raw.display_name !== 'string') return null
  if (typeof raw.created_at !== 'string') return null
  return {
    rank,
    user_id: raw.user_id,
    display_name: raw.display_name,
    score,
    created_at: raw.created_at,
  }
}

function toRows(value: unknown): LeaderRow[] {
  if (!Array.isArray(value)) return []
  const rows: LeaderRow[] = []
  for (const item of value) {
    const row = toRow(item)
    if (row) rows.push(row)
  }
  return rows
}

export function LeaderboardPage(): ReactNode {
  const params = useParams<{ gameId?: string }>()
  const { session } = useProfile()
  const raw = params.gameId ?? 'snake'
  const gameId = isGameId(raw) ? raw : 'snake'
  const game = getGame(gameId)
  const [rows, setRows] = useState<LeaderRow[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const client = supabase
    if (!client) return
    let alive = true
    setState('loading')

    const run = async (): Promise<void> => {
      try {
        const { data, error: rpcError } = await client.rpc('leaderboard', {
          p_game_id: gameId,
          p_limit: 50,
        })
        if (!alive) return
        if (rpcError) {
          setState('error')
          return
        }
        setRows(toRows(data))
        setState('ready')
      } catch {
        if (alive) setState('error')
      }
    }

    void run()
    return () => {
      alive = false
    }
  }, [gameId, reload])

  const offline = supabase === null
  const meId = session?.user.id
  const subtitle = game ? `Top 50 global scores in ${game.title} — refreshed on demand.` : ''

  return (
    <div className="page">
      <h1>Leaderboard</h1>
      <p className="muted">{subtitle}</p>

      <div className="chips lb-tabs" role="tablist" aria-label="Leaderboard by game">
        {GAMES.map((entry) => (
          <Link
            key={entry.id}
            to={`/leaderboard/${entry.id}`}
            role="tab"
            aria-selected={entry.id === gameId}
            className={`chip ${entry.id === gameId ? 'chip-on' : ''}`}
          >
            {entry.title}
          </Link>
        ))}
      </div>

      {offline ? (
        <p className="muted empty">
          Leaderboards need a connection — your local best is saved on this device.
        </p>
      ) : (
        <>
          <div className="lb-tools">
            <span className="muted">
              {state === 'ready'
                ? rows.length === 0
                  ? 'No scores yet'
                  : `${rows.length} players`
                : ''}
            </span>
            <button
              type="button"
              className="btn"
              onClick={() => setReload((value) => value + 1)}
              disabled={state === 'loading'}
            >
              ↻ Refresh
            </button>
          </div>

          {state === 'loading' && (
            <div className="lb-skeleton" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <div className="lb-skel-row" key={index} />
              ))}
            </div>
          )}

          {state === 'error' && (
            <div className="fallback">
              <p className="muted">Could not load the board — check your connection.</p>
              <button type="button" className="btn" onClick={() => setReload((value) => value + 1)}>
                Try again
              </button>
            </div>
          )}

          {state === 'ready' && rows.length === 0 && (
            <p className="muted empty">
              No scores on the {game?.title ?? 'game'} board yet — play a round to claim #1.
            </p>
          )}

          {state === 'ready' && rows.length > 0 && (
            <div className="lb-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Player</th>
                    <th>Score</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.user_id} className={row.user_id === meId ? 'me' : undefined}>
                      <td className={row.rank === 1 ? 'rank-1' : undefined}>#{row.rank}</td>
                      <td>{row.display_name}</td>
                      <td>{row.score.toLocaleString()}</td>
                      <td className="muted">{new Date(row.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
