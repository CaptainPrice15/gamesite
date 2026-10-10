import type { Rng } from '../../core/rng'
import type { Difficulty } from '../../core/types'

export type Dir = 'up' | 'down' | 'left' | 'right'

export const SIZE = 4
export const CELLS = SIZE * SIZE

export interface TileMove {
  from: number
  to: number
  value: number
}

export interface MoveResult {
  board: number[]
  moves: TileMove[]
  score: number
  merges: number
  mergedValues: number[]
  changed: boolean
}

export interface SpawnResult {
  board: number[]
  index: number
  value: number
}

function buildLines(dir: Dir): number[][] {
  const lines: number[][] = []
  if (dir === 'left' || dir === 'right') {
    for (let y = 0; y < SIZE; y++) {
      const line: number[] = []
      for (let k = 0; k < SIZE; k++) {
        const x = dir === 'left' ? k : SIZE - 1 - k
        line.push(y * SIZE + x)
      }
      lines.push(line)
    }
  } else {
    for (let x = 0; x < SIZE; x++) {
      const line: number[] = []
      for (let k = 0; k < SIZE; k++) {
        const y = dir === 'up' ? k : SIZE - 1 - k
        line.push(y * SIZE + x)
      }
      lines.push(line)
    }
  }
  return lines
}

const LINES: Record<Dir, number[][]> = {
  left: buildLines('left'),
  right: buildLines('right'),
  up: buildLines('up'),
  down: buildLines('down'),
}

export function applyMove(board: number[], dir: Dir): MoveResult {
  const next = board.slice()
  const moves: TileMove[] = []
  const mergedValues: number[] = []
  let score = 0
  let changed = false

  for (const line of LINES[dir]) {
    const entries: { value: number; from: number }[] = []
    for (const cell of line) {
      const value = board[cell]
      if (value !== 0) entries.push({ value, from: cell })
    }

    const out = new Array<number>(SIZE).fill(0)
    let i = 0
    let pos = 0
    while (i < entries.length) {
      const current = entries[i]
      const following = entries[i + 1]
      const to = line[pos]
      if (following && following.value === current.value) {
        const merged = current.value * 2
        out[pos] = merged
        moves.push({ from: current.from, to, value: current.value })
        moves.push({ from: following.from, to, value: following.value })
        mergedValues.push(merged)
        score += merged
        i += 2
      } else {
        out[pos] = current.value
        moves.push({ from: current.from, to, value: current.value })
        i += 1
      }
      pos += 1
    }

    for (let k = 0; k < SIZE; k++) {
      const cell = line[k]
      next[cell] = out[k]
      if (out[k] !== board[cell]) changed = true
    }
  }

  return { board: next, moves, score, merges: mergedValues.length, mergedValues, changed }
}

export function canMove(board: number[]): boolean {
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 0) return true
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const value = board[y * SIZE + x]
      if (x + 1 < SIZE && board[y * SIZE + x + 1] === value) return true
      if (y + 1 < SIZE && board[(y + 1) * SIZE + x] === value) return true
    }
  }
  return false
}

export function spawnTile(board: number[], rng: Rng, fourChance: number): SpawnResult | null {
  const empty: number[] = []
  for (let i = 0; i < board.length; i++) {
    if (board[i] === 0) empty.push(i)
  }
  if (empty.length === 0) return null
  const index = empty[Math.floor(rng() * empty.length)]
  const value = rng() < fourChance ? 4 : 2
  const next = board.slice()
  next[index] = value
  return { board: next, index, value }
}

export function createBoard(rng: Rng, fourChance: number): number[] {
  let board = new Array<number>(CELLS).fill(0)
  for (let i = 0; i < 2; i++) {
    const spawned = spawnTile(board, rng, fourChance)
    if (spawned) board = spawned.board
  }
  return board
}

export function bestTile(board: number[]): number {
  let best = 0
  for (const value of board) {
    if (value > best) best = value
  }
  return best
}

export function fourChanceFor(difficulty: Difficulty): number {
  return { easy: 0.05, normal: 0.1, hard: 0.15 }[difficulty]
}
