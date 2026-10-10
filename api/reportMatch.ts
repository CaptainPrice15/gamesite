import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { isUuid, reportsAgree, type MatchReport } from '../src/shared/match'
import { clientKey, rateLimit } from '../src/shared/rateLimit'

const REPORT_TIMEOUT_MS = 60_000
const MAX_SCORE = 1_000_000
const RATE_LIMIT_PER_MIN = 30
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface MatchRow {
  id: string
  game_id: string
  mode: string
  p1: string
  p2: string | null
  status: string
  p1_elo_before: number | null
  p1_elo_after: number | null
  p2_elo_before: number | null
  p2_elo_after: number | null
}

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

function readWinner(value: unknown): { ok: true; winner: string | null } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, winner: null }
  if (typeof value === 'string' && UUID_RE.test(value)) return { ok: true, winner: value }
  return { ok: false }
}

function readScore(value: unknown): number | null {
  if (value === undefined) return 0
  if (typeof value !== 'number' || !Number.isInteger(value)) return null
  if (value < 0 || value > MAX_SCORE) return null
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

function eloPayload(match: MatchRow, userId: string): Record<string, number> | null {
  const isP1 = match.p1 === userId
  const before = isP1 ? match.p1_elo_before : match.p2_elo_before
  const after = isP1 ? match.p1_elo_after : match.p2_elo_after
  if (before === null || after === null) return null
  return { before, after, delta: after - before }
}

function finalPayload(match: MatchRow, userId: string): Record<string, unknown> {
  const payload: Record<string, unknown> = { ok: true, status: match.status }
  if (match.mode === 'ranked' && match.status === 'finished') {
    payload.ranked = true
    const elo = eloPayload(match, userId)
    if (elo) payload.elo = elo
  }
  return payload
}

async function loadMatch(db: SupabaseClient, matchId: string): Promise<MatchRow | null> {
  const { data, error } = await db
    .from('matches')
    .select(
      'id, game_id, mode, p1, p2, status, p1_elo_before, p1_elo_after, p2_elo_before, p2_elo_after',
    )
    .eq('id', matchId)
    .maybeSingle()
  if (error || !data) return null
  return data as MatchRow
}

async function tttAuthoritativeWinner(
  db: SupabaseClient,
  matchId: string,
): Promise<{ winner: string | null } | null> {
  const { data, error } = await db
    .from('ttt_games')
    .select('winner, status')
    .eq('match_id', matchId)
    .maybeSingle()
  if (error || !data) return null
  const row = data as { winner: string | null; status: string }
  if (row.status !== 'finished') return null
  return { winner: row.winner }
}

async function upsertReport(
  db: SupabaseClient,
  matchId: string,
  userId: string,
  report: MatchReport,
  score: number,
): Promise<void> {
  await db.from('match_reports').upsert(
    {
      match_id: matchId,
      user_id: userId,
      winner: report.winner,
      score,
      is_void: report.isVoid,
    },
    { onConflict: 'match_id,user_id' },
  )
}

async function loadReport(
  db: SupabaseClient,
  matchId: string,
  userId: string | null,
): Promise<(MatchReport & { created_at: string }) | null> {
  let query = db.from('match_reports').select('winner, is_void, created_at').eq('match_id', matchId)
  query = userId === null ? query.limit(1) : query.eq('user_id', userId)
  const { data, error } = await query.maybeSingle()
  if (error || !data) return null
  const row = data as { winner: string | null; is_void: boolean; created_at: string }
  return { winner: row.winner, isVoid: row.is_void === true, created_at: row.created_at }
}

async function reportScores(
  db: SupabaseClient,
  match: MatchRow,
): Promise<{ p1_score: number; p2_score: number }> {
  const { data } = await db.from('match_reports').select('user_id, score').eq('match_id', match.id)
  const rows = Array.isArray(data) ? (data as Array<{ user_id: string; score: number }>) : []
  const scoreFor = (uid: string): number => rows.find((row) => row.user_id === uid)?.score ?? 0
  return { p1_score: scoreFor(match.p1), p2_score: scoreFor(match.p2 ?? '') }
}

async function settle(
  db: SupabaseClient,
  match: MatchRow,
  userId: string,
  options: { winner: string | null; isVoid: boolean },
): Promise<Record<string, unknown>> {
  const scores = await reportScores(db, match)
  const result = {
    winner: options.isVoid ? null : options.winner,
    p1_score: scores.p1_score,
    p2_score: scores.p2_score,
    ...(options.isVoid ? { void: true } : {}),
  }
  try {
    const { data, error } = await db.rpc('finish_match', {
      p_match_id: match.id,
      p_result: result,
    })
    if (error) throw new Error(error.message)
    const payload = (data ?? {}) as Record<string, unknown>
    const status = typeof payload.status === 'string' ? payload.status : 'finished'
    const response: Record<string, unknown> = { ok: true, status }
    if (status === 'finished' && match.mode === 'ranked') {
      response.ranked = true
      if (payload.p1_elo_after === undefined) {
        const elo = eloPayload(match, userId)
        if (elo) response.elo = elo
      } else {
        const isP1 = match.p1 === userId
        const before = isP1 ? match.p1_elo_before : match.p2_elo_before
        const after = (isP1 ? payload.p1_elo_after : payload.p2_elo_after) as number
        if (before !== null) {
          response.elo = { before, after, delta: after - before }
        }
      }
    }
    return response
  } catch {
    return { error: 'failed to finalize match' }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'method not allowed' })
    return
  }

  const limit = rateLimit(`report:${clientKey(req)}`, RATE_LIMIT_PER_MIN)
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

  if (typeof body.matchId !== 'string' || !isUuid(body.matchId)) {
    res.status(400).json({ error: 'invalid matchId' })
    return
  }

  const winner = readWinner(body.winner)
  if (!winner.ok) {
    res.status(400).json({ error: 'invalid winner' })
    return
  }

  const score = readScore(body.score)
  if (score === null) {
    res.status(400).json({ error: 'invalid score' })
    return
  }

  const isVoid = body.isVoid === true

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
  const userId = userData.user.id

  const db = serviceClient(url, serviceKey)
  const match = await loadMatch(db, body.matchId)
  if (!match) {
    res.status(404).json({ error: 'match not found' })
    return
  }
  if (match.p1 !== userId && match.p2 !== userId) {
    res.status(403).json({ error: 'not a match participant' })
    return
  }
  if (match.status === 'finished' || match.status === 'void') {
    res.status(200).json(finalPayload(match, userId))
    return
  }
  if (match.p2 === null) {
    res.status(409).json({ error: 'match has no opponent' })
    return
  }

  let report: MatchReport = { winner: winner.winner, isVoid }
  if (match.game_id === 'ttt' && !isVoid) {
    const ttt = await tttAuthoritativeWinner(db, match.id)
    if (ttt) report = { winner: ttt.winner, isVoid: false }
  }

  const previous = await loadReport(db, match.id, userId)
  await upsertReport(db, match.id, userId, report, score)

  const opponentReport = await loadReport(db, match.id, userId === match.p1 ? match.p2 : match.p1)

  if (!opponentReport) {
    if (previous) {
      const age = Date.now() - new Date(previous.created_at).getTime()
      if (Number.isFinite(age) && age > REPORT_TIMEOUT_MS) {
        const settled = await settle(db, match, userId, {
          winner: report.winner,
          isVoid: true,
        })
        if ('error' in settled) {
          res.status(500).json({ error: settled.error })
          return
        }
        res.status(200).json(settled)
        return
      }
    }
    res.status(200).json({ ok: true, pending: true })
    return
  }

  const age = Date.now() - new Date(opponentReport.created_at).getTime()
  const stale = Number.isFinite(age) && age > REPORT_TIMEOUT_MS
  const agree =
    !stale &&
    reportsAgree(report, {
      winner: opponentReport.winner,
      isVoid: opponentReport.isVoid,
    })
  const settled = await settle(db, match, userId, {
    winner: report.winner,
    isVoid: !agree || report.isVoid,
  })
  if ('error' in settled) {
    res.status(500).json({ error: settled.error })
    return
  }
  res.status(200).json(settled)
}
