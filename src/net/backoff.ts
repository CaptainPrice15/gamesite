export const BACKOFF_BASE_MS = 1000
export const BACKOFF_CAP_MS = 30000

export function backoffDelay(
  attempt: number,
  baseMs = BACKOFF_BASE_MS,
  capMs = BACKOFF_CAP_MS,
): number {
  const safeAttempt = Number.isNaN(attempt) || attempt < 0 ? 0 : Math.floor(attempt)
  return Math.min(capMs, baseMs * 2 ** safeAttempt)
}

export function backoffSchedule(attempts: number, baseMs?: number, capMs?: number): number[] {
  return Array.from({ length: Math.max(0, attempts) }, (_, index) =>
    backoffDelay(index, baseMs, capMs),
  )
}
