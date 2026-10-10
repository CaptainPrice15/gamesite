export const DEFAULT_ELO = 1200
export const K_FACTOR = 32

export function expectedScore(rating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - rating) / 400))
}

function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

export function eloDelta(
  rating: number,
  opponentRating: number,
  score: 0 | 0.5 | 1,
  k: number = K_FACTOR,
): number {
  return roundHalfAwayFromZero(k * (score - expectedScore(rating, opponentRating)))
}

export function clampRating(rating: number): number {
  return Math.max(0, Math.min(4000, rating))
}

export function formatDelta(delta: number): string {
  if (delta > 0) return `+${delta}`
  return `${delta}`
}
