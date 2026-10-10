export const GAME_IDS = ['snake', '2048', 'breakout', 'blocks', 'pong', 'ttt'] as const

export type GameId = (typeof GAME_IDS)[number]

export const MAX_SCORES: Record<GameId, number> = {
  snake: 200000,
  '2048': 400000,
  breakout: 200000,
  blocks: 1000000,
  pong: 11,
  ttt: 900,
}

export type ScoreValidation =
  { ok: true; gameId: GameId; score: number } | { ok: false; error: string }

export function isGameId(value: unknown): value is GameId {
  return typeof value === 'string' && (GAME_IDS as readonly string[]).includes(value)
}

export function validateScore(gameId: unknown, score: unknown): ScoreValidation {
  if (!isGameId(gameId)) return { ok: false, error: 'unknown game id' }
  if (typeof score !== 'number' || !Number.isInteger(score)) {
    return { ok: false, error: 'score must be an integer' }
  }
  if (score < 0) return { ok: false, error: 'score must be zero or greater' }
  const cap = MAX_SCORES[gameId]
  if (score > cap) return { ok: false, error: `score exceeds the ${gameId} cap of ${cap}` }
  return { ok: true, gameId, score }
}
