import type { Rng } from '../../core/rng'

export const COLS = 10
export const ROWS = 20
export const BUFFER_ROWS = 2
export const TOTAL_ROWS = ROWS + BUFFER_ROWS
export const QUEUE_LENGTH = 5
export const LOCK_DELAY = 0.5
export const MAX_LOCK_RESETS = 15
export const CLEAR_FLASH = 0.15
export const DAS_DELAY = 0.15
export const DAS_RATE = 0.04
export const SOFT_DROP_INTERVAL = 0.04

const LINE_SCORES = [0, 100, 300, 500, 800]
const KICK_OFFSETS = [0, -1, 1, -2, 2]
const SPAWN_Y = 1

export type PieceKind = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L'

export const PIECE_KINDS: readonly PieceKind[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L']

export interface Cell {
  x: number
  y: number
}

export type Board = (PieceKind | null)[][]

export interface Piece {
  kind: PieceKind
  x: number
  y: number
  box: number
  cells: Cell[]
}

export interface TetrisState {
  board: Board
  piece: Piece | null
  queue: PieceKind[]
  hold: PieceKind | null
  canHold: boolean
  score: number
  lines: number
  level: number
  gameOver: boolean
  clearRows: number[]
  clearTimer: number
  attract: boolean
}

interface Shape {
  box: number
  cells: Cell[]
}

const c = (x: number, y: number): Cell => ({ x, y })

const SHAPES: Record<PieceKind, Shape> = {
  I: { box: 4, cells: [c(0, 1), c(1, 1), c(2, 1), c(3, 1)] },
  O: { box: 2, cells: [c(0, 0), c(1, 0), c(0, 1), c(1, 1)] },
  T: { box: 3, cells: [c(1, 0), c(0, 1), c(1, 1), c(2, 1)] },
  S: { box: 3, cells: [c(1, 0), c(2, 0), c(0, 1), c(1, 1)] },
  Z: { box: 3, cells: [c(0, 0), c(1, 0), c(1, 1), c(2, 1)] },
  J: { box: 3, cells: [c(0, 0), c(0, 1), c(1, 1), c(2, 1)] },
  L: { box: 3, cells: [c(2, 0), c(0, 1), c(1, 1), c(2, 1)] },
}

export function createBoard(): Board {
  return Array.from({ length: TOTAL_ROWS }, () => Array.from({ length: COLS }, () => null))
}

export function createBag(rng: Rng): PieceKind[] {
  const bag = [...PIECE_KINDS]
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = bag[i]
    bag[i] = bag[j]
    bag[j] = tmp
  }
  return bag
}

export function createPiece(kind: PieceKind): Piece {
  const shape = SHAPES[kind]
  return {
    kind,
    x: Math.floor((COLS - shape.box) / 2),
    y: SPAWN_Y,
    box: shape.box,
    cells: shape.cells.map((cell) => ({ x: cell.x, y: cell.y })),
  }
}

export function pieceCells(piece: Piece): Cell[] {
  return piece.cells.map((cell) => ({ x: piece.x + cell.x, y: piece.y + cell.y }))
}

export function collides(board: Board, piece: Piece): boolean {
  for (const cell of piece.cells) {
    const x = piece.x + cell.x
    const y = piece.y + cell.y
    if (x < 0 || x >= COLS || y < 0 || y >= TOTAL_ROWS) return true
    if (board[y][x]) return true
  }
  return false
}

export function rotateCells(cells: Cell[], box: number): Cell[] {
  return cells.map((cell) => ({ x: box - 1 - cell.y, y: cell.x }))
}

export function tryMove(state: TetrisState, dx: number, dy: number): boolean {
  const piece = state.piece
  if (!piece) return false
  const moved: Piece = { ...piece, x: piece.x + dx, y: piece.y + dy }
  if (collides(state.board, moved)) return false
  state.piece = moved
  return true
}

export function tryRotate(state: TetrisState): boolean {
  const piece = state.piece
  if (!piece) return false
  const spun = rotateCells(piece.cells, piece.box)
  const kicks: Cell[] = KICK_OFFSETS.map((dx) => ({ x: dx, y: 0 }))
  kicks.push({ x: 0, y: -1 })
  for (const kick of kicks) {
    const cand: Piece = {
      kind: piece.kind,
      x: piece.x + kick.x,
      y: piece.y + kick.y,
      box: piece.box,
      cells: spun,
    }
    if (!collides(state.board, cand)) {
      state.piece = cand
      return true
    }
  }
  return false
}

export function ghostY(state: TetrisState): number {
  const piece = state.piece
  if (!piece) return 0
  let y = piece.y
  while (!collides(state.board, { ...piece, y: y + 1 })) y++
  return y
}

export function softDrop(state: TetrisState): boolean {
  if (!tryMove(state, 0, 1)) return false
  state.score += 1
  return true
}

export function hardDrop(state: TetrisState): number {
  const piece = state.piece
  if (!piece) return 0
  let cells = 0
  while (tryMove(state, 0, 1)) cells++
  state.score += cells * 2
  return cells
}

export function fullRows(board: Board): number[] {
  const rows: number[] = []
  for (let y = 0; y < TOTAL_ROWS; y++) {
    if (board[y].every((cell) => cell !== null)) rows.push(y)
  }
  return rows
}

export function lineScore(count: number, level: number): number {
  return (LINE_SCORES[count] ?? 0) * level
}

export function levelForLines(lines: number): number {
  return Math.floor(lines / 10) + 1
}

export function gravityInterval(level: number): number {
  return Math.max(0.05, 0.8 - (level - 1) * 0.06)
}

function ensureQueue(state: TetrisState, rng: Rng): void {
  while (state.queue.length < QUEUE_LENGTH) {
    for (const kind of createBag(rng)) state.queue.push(kind)
  }
}

export function spawnNext(state: TetrisState, rng: Rng): boolean {
  ensureQueue(state, rng)
  const kind = state.queue[0]
  state.queue.shift()
  ensureQueue(state, rng)
  const piece = createPiece(kind)
  state.piece = piece
  if (collides(state.board, piece)) {
    state.gameOver = true
    return false
  }
  return true
}

export function lockPiece(state: TetrisState, rng: Rng): number {
  const piece = state.piece
  if (!piece) return 0
  for (const cell of pieceCells(piece)) {
    if (cell.x >= 0 && cell.x < COLS && cell.y >= 0 && cell.y < TOTAL_ROWS) {
      state.board[cell.y][cell.x] = piece.kind
    }
  }
  state.piece = null
  state.canHold = true
  const rows = fullRows(state.board)
  if (rows.length > 0) {
    state.score += lineScore(rows.length, state.level)
    state.lines += rows.length
    state.level = levelForLines(state.lines)
    state.clearRows = rows
    state.clearTimer = CLEAR_FLASH
    return rows.length
  }
  spawnNext(state, rng)
  return 0
}

export function finishClear(state: TetrisState, rng: Rng): void {
  if (state.clearRows.length === 0) return
  const cleared = new Set(state.clearRows)
  const kept = state.board.filter((_row, y) => !cleared.has(y))
  while (kept.length < TOTAL_ROWS) kept.unshift(Array.from({ length: COLS }, () => null))
  state.board = kept
  state.clearRows = []
  state.clearTimer = 0
  spawnNext(state, rng)
}

export function updateClear(state: TetrisState, dt: number, rng: Rng): void {
  if (state.clearRows.length === 0) return
  state.clearTimer -= dt
  if (state.clearTimer <= 0) finishClear(state, rng)
}

export function holdPiece(state: TetrisState, rng: Rng): boolean {
  const piece = state.piece
  if (!piece || !state.canHold) return false
  const kind = piece.kind
  const held = state.hold
  state.hold = kind
  state.canHold = false
  if (held) {
    const swap = createPiece(held)
    state.piece = swap
    if (collides(state.board, swap)) state.gameOver = true
  } else {
    spawnNext(state, rng)
  }
  return true
}

function fillAttractStack(board: Board, rng: Rng): void {
  for (let x = 0; x < COLS; x++) {
    const height = 1 + Math.floor(rng() * 4)
    for (let i = 0; i < height; i++) {
      const y = TOTAL_ROWS - 1 - i
      if (rng() < 0.22) continue
      board[y][x] = PIECE_KINDS[Math.floor(rng() * PIECE_KINDS.length)]
    }
  }
  for (let y = TOTAL_ROWS - 4; y < TOTAL_ROWS; y++) {
    if (board[y].every((cell) => cell !== null)) {
      board[y][Math.floor(rng() * COLS)] = null
    }
  }
}

export function createInitialState(rng: Rng): TetrisState {
  const board = createBoard()
  fillAttractStack(board, rng)
  const state: TetrisState = {
    board,
    piece: null,
    queue: [],
    hold: null,
    canHold: true,
    score: 0,
    lines: 0,
    level: 1,
    gameOver: false,
    clearRows: [],
    clearTimer: 0,
    attract: true,
  }
  spawnNext(state, rng)
  return state
}

export function beginPlay(state: TetrisState): void {
  if (!state.attract) return
  state.attract = false
  state.board = createBoard()
}
