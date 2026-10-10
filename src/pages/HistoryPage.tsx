import { useEffect, useState, type ReactNode } from 'react'
import { getGame } from '../games/registry'
import { useProfile } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { formatDelta } from '../shared/elo'
import { matchOutcome } from '../shared/match'
import '../styles/online.css'

interface HistoryRow {
  id: string
  gameId: string
  mode: string
  status: string
  p1: string
  p2: string | null
  winner: string | null
  eloDelta: number | null
  createdAt: string
}

type LoadState = 'loading' | 'ready' | 'error'

const HISTORY_LIMIT = 10

function readWinner(result: unknown): string | null {
  if (typeof result !== 'object' || result === null) return null
  const winner = (result as Record<string, unknown>).winner
  return typeof winner === 'string' && winner !== '' ? winner : null
}

function readDelta(raw: Record<string, unknown>, me: string): number | null {
  if (raw.mode !== 'ranked' || raw.status !== 'finished') return null
  const isP1 = raw.p1 === me
  const before = isP1 ? raw.p1_elo_before : raw.p2_elo_before
  const after = isP1 ? raw.p1_elo_after : raw.p2_elo_after
  if (typeof before !== 'number' || typeof after !== 'number') return null
  return after - before
}

function toRow(value: unknown, me: string): HistoryRow | null {
  if (typeof value !== 'object' || value === null) return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id === '') return null
  if (typeof raw.game_id !== 'string') return null
  if (typeof raw.mode !== 'string') return null
  if (typeof raw.status !== 'string') return null
  if (typeof raw.p1 !== 'string') return null
  if (typeof raw.created_at !== 'string') return null
  const p2 = typeof raw.p2 === 'string' && raw.p2 !== '' ? raw.p2 : null
  return {
    id: raw.id,
    gameId: raw.game_id,
    mode: raw.mode,
    status: raw.status,
    p1: raw.p1,
    p2,
    winner: readWinner(raw.result),
    eloDelta: readDelta(raw, me),
    createdAt: raw.created_at,
  }
}

function toRows(value: unknown, me: string): HistoryRow[] {
  if (!Array.isArray(value)) return []
  const rows: HistoryRow[] = []
  for (const item of value) {
    const row = toRow(item, me)
    if (row) rows.push(row)
  }
  return rows
}

function opponentOf(row: HistoryRow, me: string): string {
  if (row.p1 === me) return row.p2 ?? ''
  return row.p1
}

const OUTCOME_LABEL: Record<string, string> = {
  win: 'Win',
  loss: 'Loss',
  draw: 'Draw',
  void: 'Void',
  unfinished: 'Unfinished',
}

export function HistoryPage(): ReactNode {
  const { session, profile } = useProfile()
  const me = session?.user.id ?? ''
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [state, setState] = useState<LoadState>('loading')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const client = supabase
    if (!client || me === '') return
    let alive = true
    setState('loading')

    const run = async (): Promise<void> => {
      try {
        const { data, error: queryError } = await client
          .from('matches')
          .select(
            'id, game_id, mode, status, p1, p2, result, p1_elo_before, p1_elo_after, p2_elo_before, p2_elo_after, created_at',
          )
          .or(`p1.eq.${me},p2.eq.${me}`)
          .order('created_at', { ascending: false })
          .limit(HISTORY_LIMIT)
        if (!alive) return
        if (queryError) {
          setState('error')
          return
        }
        const parsed = toRows(data, me)
        setRows(parsed)

        const ids = Array.from(
          new Set(parsed.map((row) => opponentOf(row, me)).filter((id) => id !== '')),
        )
        if (ids.length > 0) {
          const { data: profiles } = await client
            .from('profiles')
            .select('user_id, display_name')
            .in('user_id', ids)
          if (!alive) return
          const map: Record<string, string> = {}
          if (Array.isArray(profiles)) {
            for (const row of profiles as Array<{ user_id?: unknown; display_name?: unknown }>) {
              if (typeof row.user_id === 'string' && typeof row.display_name === 'string') {
                map[row.user_id] = row.display_name
              }
            }
          }
          setNames(map)
        }
        setState('ready')
      } catch {
        if (alive) setState('error')
      }
    }

    void run()
    return () => {
      alive = false
    }
  }, [me, reload])

  const offline = supabase === null

  return (
    <div className="page">
      <h1>Match history</h1>
      <p className="muted">
        {profile
          ? `Your rating: ${profile.elo} — last ${HISTORY_LIMIT} online matches.`
          : 'Your last online matches, newest first.'}
      </p>

      {offline ? (
        <p className="muted empty">Match history needs a connection — play solo offline instead.</p>
      ) : (
        <>
          <div className="lb-tools">
            <span className="muted">
              {state === 'ready'
                ? rows.length === 0
                  ? 'No matches yet'
                  : `${rows.length} matches`
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
              {Array.from({ length: 6 }, (_, index) => (
                <div className="lb-skel-row" key={index} />
              ))}
            </div>
          )}

          {state === 'error' && (
            <div className="fallback">
              <p className="muted">Could not load your matches — check your connection.</p>
              <button type="button" className="btn" onClick={() => setReload((value) => value + 1)}>
                Try again
              </button>
            </div>
          )}

          {state === 'ready' && rows.length === 0 && (
            <p className="muted empty">
              No matches yet — open Pong or Tic-Tac-Toe and find an opponent.
            </p>
          )}

          {state === 'ready' && rows.length > 0 && (
            <div className="lb-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Game</th>
                    <th>Mode</th>
                    <th>Result</th>
                    <th>Opponent</th>
                    <th>Rating</th>
                    <th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const opponent = opponentOf(row, me)
                    const outcome = matchOutcome(row.status, row.winner, me, opponent)
                    return (
                      <tr key={row.id}>
                        <td>{getGame(row.gameId)?.title ?? row.gameId}</td>
                        <td className="muted">{row.mode}</td>
                        <td>
                          <span className={`hist-outcome ${outcome}`}>
                            {OUTCOME_LABEL[outcome] ?? outcome}
                          </span>
                        </td>
                        <td>{opponent === '' ? '—' : (names[opponent] ?? 'Opponent')}</td>
                        <td>
                          {row.eloDelta === null ? (
                            <span className="muted">—</span>
                          ) : (
                            <span className={`hist-delta ${row.eloDelta >= 0 ? 'up' : 'down'}`}>
                              {formatDelta(row.eloDelta)}
                            </span>
                          )}
                        </td>
                        <td className="muted">{new Date(row.createdAt).toLocaleDateString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
