const PREFIX = 'arcade.'

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    /* quota / private mode — ignore */
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    /* ignore */
  }
}

export function loadBest(gameId: string): number {
  const v = load<number>(`best.${gameId}`, 0)
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
}

/** Returns the new best if the score beats it. */
export function saveBest(gameId: string, score: number): { best: number; isRecord: boolean } {
  const prev = loadBest(gameId)
  if (score > prev) {
    save(`best.${gameId}`, score)
    return { best: score, isRecord: true }
  }
  return { best: prev, isRecord: false }
}
