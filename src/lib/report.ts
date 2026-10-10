import { supabase } from './supabase'

export interface ReportInput {
  matchId: string
  winner: string | null
  score: number
}

export interface ReportElo {
  before: number
  after: number
  delta: number
}

export interface ReportOutcome {
  ok: boolean
  pending?: boolean
  status?: string
  elo?: ReportElo
}

const RETRY_DELAYS_MS = [5_000, 10_000, 15_000, 30_000, 30_000]

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseOutcome(value: unknown): ReportOutcome | null {
  if (typeof value !== 'object' || value === null) return null
  const body = value as { ok?: unknown; pending?: unknown; status?: unknown; elo?: unknown }
  if (body.ok !== true) return null
  const outcome: ReportOutcome = { ok: true }
  if (body.pending === true) outcome.pending = true
  if (typeof body.status === 'string') outcome.status = body.status
  if (typeof body.elo === 'object' && body.elo !== null) {
    const elo = body.elo as { before?: unknown; after?: unknown; delta?: unknown }
    if (
      typeof elo.before === 'number' &&
      typeof elo.after === 'number' &&
      typeof elo.delta === 'number'
    ) {
      outcome.elo = { before: elo.before, after: elo.after, delta: elo.delta }
    }
  }
  return outcome
}

async function send(input: ReportInput, token: string): Promise<ReportOutcome | 'retry'> {
  try {
    const response = await fetch('/api/reportMatch', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        matchId: input.matchId,
        winner: input.winner,
        score: input.score,
      }),
    })
    if (response.status >= 500 || response.status === 429) return 'retry'
    if (!response.ok) return { ok: false }
    const payload: unknown = await response.json()
    const outcome = parseOutcome(payload)
    return outcome ?? 'retry'
  } catch {
    return 'retry'
  }
}

export async function reportMatch(input: ReportInput): Promise<ReportOutcome> {
  if (!supabase) return { ok: false }

  try {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) return { ok: false }
    const token = data.session?.access_token
    if (!token) return { ok: false }

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      const result = await send(input, token)
      if (result !== 'retry') return result
      if (attempt === RETRY_DELAYS_MS.length) break
      await sleep(RETRY_DELAYS_MS[attempt])
    }
    return { ok: false }
  } catch {
    return { ok: false }
  }
}
