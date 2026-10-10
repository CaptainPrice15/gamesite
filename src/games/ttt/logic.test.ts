import { describe, expect, it } from 'vitest'
import {
  CELL_COUNT,
  DEMO_BOARD,
  LINES,
  createRound,
  emptyBoard,
  isFull,
  placeMark,
  reduceRound,
  sessionScore,
  starterFor,
  winnerOf,
  type Board,
} from './logic'

describe('ttt logic', () => {
  it('creates an empty 3x3 board', () => {
    const board = emptyBoard()
    expect(board).toHaveLength(CELL_COUNT)
    expect(board.every((cell) => cell === null)).toBe(true)
  })

  it('places a mark on an empty cell without mutating the input', () => {
    const board = emptyBoard()
    const next = placeMark(board, 4, 'X')
    expect(next?.[4]).toBe('X')
    expect(board[4]).toBeNull()
  })

  it('rejects occupied, out-of-range and fractional cells', () => {
    const board = emptyBoard()
    board[0] = 'O'
    expect(placeMark(board, 0, 'X')).toBeNull()
    expect(placeMark(board, -1, 'X')).toBeNull()
    expect(placeMark(board, 9, 'X')).toBeNull()
    expect(placeMark(board, 1.5, 'X')).toBeNull()
    expect(placeMark(board, Number.NaN, 'X')).toBeNull()
  })

  it('detects a win on every one of the eight lines', () => {
    for (const line of LINES) {
      const xBoard = emptyBoard()
      for (const index of line) xBoard[index] = 'X'
      const xWin = winnerOf(xBoard)
      expect(xWin?.mark).toBe('X')
      expect(xWin?.line).toEqual(line)

      const oBoard = emptyBoard()
      for (const index of line) oBoard[index] = 'O'
      const oWin = winnerOf(oBoard)
      expect(oWin?.mark).toBe('O')
      expect(oWin?.line).toEqual(line)
    }
  })

  it('returns null while nobody has won', () => {
    expect(winnerOf(DEMO_BOARD)).toBeNull()
    const board = emptyBoard()
    board[0] = 'X'
    board[4] = 'X'
    expect(winnerOf(board)).toBeNull()
  })

  it('keeps reporting a win on a completely full board', () => {
    const board: Board = ['X', 'X', 'X', 'O', 'O', 'X', 'O', 'X', 'O']
    expect(winnerOf(board)?.mark).toBe('X')
    expect(winnerOf(board)?.line).toEqual([0, 1, 2])
    expect(isFull(board)).toBe(true)
  })

  it('reports fullness only when all nine cells are taken', () => {
    expect(isFull(emptyBoard())).toBe(false)
    expect(isFull(DEMO_BOARD)).toBe(false)
    expect(isFull(['X', 'O', 'X', 'O', 'X', 'O', 'O', 'X', 'X'])).toBe(true)
  })

  it('alternates the starting mark by round parity', () => {
    expect(starterFor(1)).toBe('X')
    expect(starterFor(2)).toBe('O')
    expect(starterFor(3)).toBe('X')
  })

  it('starts a fresh round with X to move on an empty board', () => {
    const state = createRound()
    expect(state.round).toBe(1)
    expect(state.starter).toBe('X')
    expect(state.turn).toBe('X')
    expect(state.status).toBe('playing')
    expect(state.winner).toBeNull()
    expect(state.winLine).toBeNull()
    expect(state.board).toEqual(emptyBoard())
    expect(state.tally).toEqual({ x: 0, o: 0, draws: 0 })
  })

  it('loads the demo position with X to move and no winner', () => {
    const state = createRound({ board: DEMO_BOARD })
    expect(state.board).toEqual(DEMO_BOARD)
    expect(winnerOf(state.board)).toBeNull()
    expect(state.turn).toBe('X')
    expect(state.board.filter((cell) => cell === 'X')).toHaveLength(3)
    expect(state.board.filter((cell) => cell === 'O')).toHaveLength(3)
  })

  it('copies the board it is given', () => {
    const state = createRound({ board: DEMO_BOARD })
    state.board[0] = 'O'
    expect(DEMO_BOARD[0]).toBe('X')
  })

  it('alternates turns after each valid move', () => {
    let state = createRound()
    state = reduceRound(state, { type: 'place', cell: 0 })
    expect(state.board[0]).toBe('X')
    expect(state.turn).toBe('O')
    state = reduceRound(state, { type: 'place', cell: 4 })
    expect(state.board[4]).toBe('O')
    expect(state.turn).toBe('X')
    expect(state.status).toBe('playing')
  })

  it('treats bad moves as no-ops that return the same state', () => {
    let state = createRound()
    state = reduceRound(state, { type: 'place', cell: 0 })
    expect(reduceRound(state, { type: 'place', cell: 0 })).toBe(state)
    expect(reduceRound(state, { type: 'place', cell: -1 })).toBe(state)
    expect(reduceRound(state, { type: 'place', cell: 9 })).toBe(state)
    expect(reduceRound(state, { type: 'place', cell: Number.NaN })).toBe(state)
    expect(state.tally).toEqual({ x: 0, o: 0, draws: 0 })
  })

  it('records a win, its line and the session tally', () => {
    let state = createRound()
    for (const cell of [0, 3, 1, 4, 2]) state = reduceRound(state, { type: 'place', cell })
    expect(state.status).toBe('win')
    expect(state.winner).toBe('X')
    expect(state.winLine).toEqual([0, 1, 2])
    expect(state.turn).toBe('X')
    expect(state.tally).toEqual({ x: 1, o: 0, draws: 0 })
    expect(reduceRound(state, { type: 'place', cell: 5 })).toBe(state)
    expect(reduceRound(state, { type: 'place', cell: 6 }).status).toBe('win')
    expect(reduceRound(state, { type: 'nextRound' }).tally).toEqual({ x: 1, o: 0, draws: 0 })
  })

  it('records a draw when the board fills with no winner', () => {
    let state = createRound()
    for (const cell of [0, 1, 2, 4, 3, 5, 7, 6, 8]) {
      state = reduceRound(state, { type: 'place', cell })
    }
    expect(state.status).toBe('draw')
    expect(state.winner).toBeNull()
    expect(state.winLine).toBeNull()
    expect(isFull(state.board)).toBe(true)
    expect(state.tally).toEqual({ x: 0, o: 0, draws: 1 })
    expect(reduceRound(state, { type: 'place', cell: 0 })).toBe(state)
  })

  it('keeps O wins in the tally', () => {
    let state = createRound()
    for (const cell of [0, 1, 2, 4, 3, 7]) state = reduceRound(state, { type: 'place', cell })
    expect(state.status).toBe('win')
    expect(state.winner).toBe('O')
    expect(state.winLine).toEqual([1, 4, 7])
    expect(state.tally).toEqual({ x: 0, o: 1, draws: 0 })
  })

  it('starts the next round with a fresh board, alternating starter', () => {
    let state = createRound()
    for (const cell of [0, 3, 1, 4, 2]) state = reduceRound(state, { type: 'place', cell })
    state = reduceRound(state, { type: 'nextRound' })
    expect(state.round).toBe(2)
    expect(state.starter).toBe('O')
    expect(state.turn).toBe('O')
    expect(state.board).toEqual(emptyBoard())
    expect(state.status).toBe('playing')
    expect(state.winner).toBeNull()
    expect(state.winLine).toBeNull()
    expect(state.tally).toEqual({ x: 1, o: 0, draws: 0 })
    const third = reduceRound(state, { type: 'nextRound' })
    expect(third.round).toBe(3)
    expect(third.starter).toBe('X')
    expect(third.turn).toBe('X')
  })

  it('carries draws across rounds in the tally', () => {
    let state = createRound()
    for (const cell of [0, 1, 2, 4, 3, 5, 7, 6, 8]) {
      state = reduceRound(state, { type: 'place', cell })
    }
    state = reduceRound(state, { type: 'nextRound' })
    expect(state.tally).toEqual({ x: 0, o: 0, draws: 1 })
    expect(state.round).toBe(2)
    expect(state.board).toEqual(emptyBoard())
  })

  it('scores the session as ten points per X win plus one per O win', () => {
    expect(sessionScore({ x: 0, o: 0, draws: 0 })).toBe(0)
    expect(sessionScore({ x: 2, o: 3, draws: 5 })).toBe(23)
  })
})
