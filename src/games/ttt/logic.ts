export const SIZE = 3
export const CELL_COUNT = SIZE * SIZE

export type Mark = 'X' | 'O'
export type Board = (Mark | null)[]
export type Line = readonly [number, number, number]
export type RoundStatus = 'playing' | 'win' | 'draw'

export interface Tally {
  x: number
  o: number
  draws: number
}

export interface WinInfo {
  mark: Mark
  line: Line
}

export interface RoundState {
  board: Board
  turn: Mark
  round: number
  starter: Mark
  status: RoundStatus
  winner: Mark | null
  winLine: Line | null
  tally: Tally
}

export type RoundAction = { type: 'place'; cell: number } | { type: 'nextRound' }

export interface RoundInit {
  round?: number
  tally?: Tally
  board?: Board
}

export const LINES: readonly Line[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

export const DEMO_BOARD: Board = ['X', 'O', 'X', 'O', 'X', null, null, null, 'O']

export function emptyBoard(): Board {
  return [null, null, null, null, null, null, null, null, null]
}

export function placeMark(board: Board, cell: number, mark: Mark): Board | null {
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) return null
  if (board[cell] !== null) return null
  const next = board.slice()
  next[cell] = mark
  return next
}

export function winnerOf(board: Board): WinInfo | null {
  for (const line of LINES) {
    const [a, b, c] = line
    const mark = board[a]
    if (mark !== null && mark === board[b] && mark === board[c]) return { mark, line }
  }
  return null
}

export function isFull(board: Board): boolean {
  return board.every((cell) => cell !== null)
}

export function starterFor(round: number): Mark {
  return round % 2 === 1 ? 'X' : 'O'
}

export function createRound(init: RoundInit = {}): RoundState {
  const round = init.round ?? 1
  const board = init.board ? init.board.slice() : emptyBoard()
  const starter = starterFor(round)
  const xCount = board.filter((cell) => cell === 'X').length
  const oCount = board.filter((cell) => cell === 'O').length
  const turn: Mark = xCount === oCount ? (xCount === 0 ? starter : 'X') : 'O'
  return {
    board,
    turn,
    round,
    starter,
    status: 'playing',
    winner: null,
    winLine: null,
    tally: init.tally ? { ...init.tally } : { x: 0, o: 0, draws: 0 },
  }
}

export function reduceRound(state: RoundState, action: RoundAction): RoundState {
  if (action.type === 'nextRound') {
    return createRound({ round: state.round + 1, tally: state.tally })
  }
  if (state.status !== 'playing') return state
  const board = placeMark(state.board, action.cell, state.turn)
  if (!board) return state
  const win = winnerOf(board)
  if (win) {
    return {
      ...state,
      board,
      status: 'win',
      winner: win.mark,
      winLine: win.line,
      tally: {
        ...state.tally,
        x: state.tally.x + (win.mark === 'X' ? 1 : 0),
        o: state.tally.o + (win.mark === 'O' ? 1 : 0),
      },
    }
  }
  if (isFull(board)) {
    return {
      ...state,
      board,
      status: 'draw',
      tally: { ...state.tally, draws: state.tally.draws + 1 },
    }
  }
  return { ...state, board, turn: state.turn === 'X' ? 'O' : 'X' }
}

export function sessionScore(tally: Tally): number {
  return tally.x * 10 + tally.o
}
