import { supabase } from './supabase'
import { validateScore } from '../shared/scoreRules'

export interface SubmitMeta {
  durationMs?: number
}

export interface SubmitResult {
  ok: boolean
  rank?: number
}

export async function submitScore(
  gameId: string,
  score: number,
  meta?: SubmitMeta,
): Promise<SubmitResult> {
  if (!supabase) return { ok: false }

  const check = validateScore(gameId, score)
  if (!check.ok) return { ok: false }

  try {
    const { data, error: sessionError } = await supabase.auth.getSession()
    if (sessionError) return { ok: false }
    const token = data.session?.access_token
    if (!token) return { ok: false }

    const durationMs =
      typeof meta?.durationMs === 'number' &&
      Number.isInteger(meta.durationMs) &&
      meta.durationMs > 0
        ? meta.durationMs
        : undefined

    const response = await fetch('/api/submitScore', {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ gameId: check.gameId, score: check.score, durationMs }),
    })

    if (!response.ok) return { ok: false }

    const payload: unknown = await response.json()
    if (typeof payload !== 'object' || payload === null) return { ok: false }
    const body = payload as { ok?: unknown; rank?: unknown }
    if (body.ok !== true) return { ok: false }
    if (typeof body.rank === 'number' && Number.isInteger(body.rank)) {
      return { ok: true, rank: body.rank }
    }
    return { ok: true }
  } catch {
    return { ok: false }
  }
}
