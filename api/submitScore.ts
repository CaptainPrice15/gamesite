import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { validateScore } from '../src/shared/scoreRules'
import { clientKey, rateLimit } from '../src/shared/rateLimit'

const DAY_MS = 86_400_000
const RATE_LIMIT_PER_MIN = 10

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readBody(req: VercelRequest): Record<string, unknown> | null {
  const raw: unknown = req.body
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return isRecord(raw) ? raw : null
}

function readDuration(value: unknown): number | null {
  if (value === undefined) return 1
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value <= 0 || value > DAY_MS) return null
  return value
}

function readToken(req: VercelRequest): string {
  const header = req.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return ''
  return header.slice(7).trim()
}

function readEnv(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

function serviceClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function readRank(
  db: SupabaseClient,
  gameId: string,
  userId: string,
): Promise<number | null> {
  try {
    const { data } = await db.rpc('leaderboard', { p_game_id: gameId, p_limit: 100 })
    if (!Array.isArray(data)) return null
    const rows = data as Array<{ user_id?: unknown }>
    const index = rows.findIndex((row) => row.user_id === userId)
    return index >= 0 ? index + 1 : null
  } catch {
    return null
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const limit = rateLimit(`score:${clientKey(req)}`, RATE_LIMIT_PER_MIN)
  if (!limit.ok) {
    res.setHeader('Retry-After', String(limit.retryAfterSec))
    res.status(429).json({ error: 'too many requests' })
    return
  }

  const body = readBody(req)
  if (!body) {
    res.status(400).json({ error: 'invalid JSON body' })
    return
  }

  const score = validateScore(body.gameId, body.score)
  if (!score.ok) {
    res.status(400).json({ error: score.error })
    return
  }

  const durationMs = readDuration(body.durationMs)
  if (durationMs === null) {
    res.status(400).json({ error: 'invalid durationMs' })
    return
  }

  const url = readEnv('SUPABASE_URL', 'VITE_SUPABASE_URL')
  const anonKey = readEnv('SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY')
  const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey || url.includes('placeholder')) {
    res.status(503).json({ error: 'not configured' })
    return
  }

  const token = readToken(req)
  if (!token) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const auth = serviceClient(url, anonKey)
  const { data: userData, error: userError } = await auth.auth.getUser(token)
  if (userError || !userData.user) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }

  const db = serviceClient(url, serviceKey)
  const { error: insertError } = await db.from('scores').insert({
    user_id: userData.user.id,
    game_id: score.gameId,
    score: score.score,
    duration_ms: durationMs,
  })
  if (insertError) {
    res.status(500).json({ error: 'failed to save score' })
    return
  }

  const rank = await readRank(db, score.gameId, userData.user.id)
  res.status(200).json(rank === null ? { ok: true } : { ok: true, rank })
}
