export type MatchMode = 'ranked' | 'casual' | 'friend'
export type RoomRole = 'p1' | 'p2'

export interface MatchReport {
  winner: string | null
  isVoid: boolean
}

export function toWinnerSide(value: unknown): RoomRole | null {
  if (value === 'p1' || value === 1) return 'p1'
  if (value === 'p2' || value === 2) return 'p2'
  return null
}

export function resolveWinnerUuid(
  metaWinner: unknown,
  role: RoomRole,
  myUid: string,
  opponentUid: string,
): string | null {
  const side = toWinnerSide(metaWinner)
  if (side === null) return null
  if (myUid === '' || opponentUid === '') return null
  const p1 = role === 'p1' ? myUid : opponentUid
  const p2 = role === 'p1' ? opponentUid : myUid
  return side === 'p1' ? p1 : p2
}

export function reportsAgree(a: MatchReport, b: MatchReport): boolean {
  return a.isVoid === b.isVoid && a.winner === b.winner
}

export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
}

export function matchOutcome(
  status: string,
  winner: string | null,
  me: string,
  opponent: string,
): 'win' | 'loss' | 'draw' | 'void' | 'unfinished' {
  if (status === 'void') return 'void'
  if (status !== 'finished') return 'unfinished'
  if (winner === null) return 'draw'
  if (winner === me) return 'win'
  if (winner === opponent) return 'loss'
  return 'unfinished'
}
