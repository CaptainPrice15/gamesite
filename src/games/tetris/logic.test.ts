import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import type {
  Action,
  AudioLike,
  Game,
  GameCreateArgs,
  GameEvents,
  GameSettings,
  HudValue,
  InputLike,
  SfxName,
} from '../../core/types'
import type { TetrisState } from './logic'
import {
  BUFFER_ROWS,
  COLS,
  TOTAL_ROWS,
  beginPlay,
  collides,
  createBag,
  createBoard,
  createInitialState,
  createPiece,
  finishClear,
  ghostY,
  gravityInterval,
  hardDrop,
  holdPiece,
  levelForLines,
  lineScore,
  lockPiece,
  pieceCells,
  rotateCells,
  softDrop,
  spawnNext,
  tryMove,
  tryRotate,
  updateClear,
} from './logic'
import { create } from './engine'

const ALL_KINDS = ['I', 'J', 'L', 'O', 'S', 'T', 'Z']

function freshState(seed = 1): TetrisState {
  return createInitialState(mulberry32(seed))
}

function cleanState(seed = 1): TetrisState {
  const state = freshState(seed)
  state.attract = false
  state.board = createBoard()
  return state
}

function countFilled(board: TetrisState['board']): number {
  let n = 0
  for (const row of board) for (const cell of row) if (cell) n++
  return n
}

describe('tetris 7-bag randomizer', () => {
  it('yields every piece exactly once per bag', () => {
    for (const seed of [1, 42, 999, 123456]) {
      const bag = createBag(mulberry32(seed))
      expect(bag).toHaveLength(7)
      expect([...bag].sort()).toEqual(ALL_KINDS)
    }
  })

  it('seeds the current piece and queue from the first bag', () => {
    const state = freshState(7)
    const drawn = [...state.queue.slice(0, 6)]
    if (state.piece) drawn.push(state.piece.kind)
    expect([...drawn].sort()).toEqual(ALL_KINDS)
  })

  it('always keeps at least five upcoming pieces in the queue', () => {
    const state = cleanState(3)
    for (let i = 0; i < 12 && !state.gameOver; i++) {
      hardDrop(state)
      lockPiece(state, mulberry32(i))
      if (state.clearRows.length > 0) finishClear(state, mulberry32(i))
      expect(state.queue.length).toBeGreaterThanOrEqual(5)
    }
  })
})

describe('tetris board and spawning', () => {
  it('creates a 10x20 visible field with two buffer rows', () => {
    const state = freshState()
    expect(state.board).toHaveLength(TOTAL_ROWS)
    expect(state.board[0]).toHaveLength(COLS)
    expect(TOTAL_ROWS - BUFFER_ROWS).toBe(20)
  })

  it('spawns the first piece fully inside the field', () => {
    const state = freshState(5)
    expect(state.piece).not.toBeNull()
    if (!state.piece) return
    for (const cell of pieceCells(state.piece)) {
      expect(cell.x).toBeGreaterThanOrEqual(0)
      expect(cell.x).toBeLessThan(COLS)
      expect(cell.y).toBeGreaterThanOrEqual(BUFFER_ROWS - 1)
      expect(cell.y).toBeLessThan(TOTAL_ROWS)
    }
  })

  it('starts with an attract stack that never fills a whole row', () => {
    const state = freshState(11)
    expect(state.attract).toBe(true)
    expect(countFilled(state.board)).toBeGreaterThan(10)
    expect(state.board.filter((row) => row.every((cell) => cell !== null))).toHaveLength(0)
  })

  it('drops the attract stack when play begins', () => {
    const state = freshState(11)
    beginPlay(state)
    expect(state.attract).toBe(false)
    expect(countFilled(state.board)).toBe(0)
    beginPlay(state)
    expect(state.attract).toBe(false)
  })

  it('detects out-of-bounds and stacked collisions', () => {
    const state = cleanState(2)
    const piece = createPiece('I')
    expect(collides(state.board, { ...piece, x: -1 })).toBe(true)
    expect(collides(state.board, { ...piece, x: COLS - 3 })).toBe(true)
    expect(collides(state.board, { ...piece, y: TOTAL_ROWS })).toBe(true)
    expect(collides(state.board, piece)).toBe(false)
    state.board[piece.y + 1][piece.x] = 'L'
    expect(collides(state.board, piece)).toBe(true)
  })
})

describe('tetris movement, rotation and drops', () => {
  it('blocks moves into walls', () => {
    const state = cleanState(4)
    if (!state.piece) throw new Error('missing piece')
    state.piece.x = 0
    expect(tryMove(state, -1, 0)).toBe(false)
    expect(state.piece.x).toBe(0)
    expect(tryMove(state, 1, 0)).toBe(true)
    expect(state.piece.x).toBe(1)
  })

  it('rotates a vertical I against the left wall without clipping', () => {
    const state = cleanState(6)
    expect(tryRotate(state)).toBe(true)
    if (!state.piece) throw new Error('missing piece')
    state.piece.x = -2
    expect(tryRotate(state)).toBe(true)
    if (!state.piece) throw new Error('missing piece')
    expect(state.piece.x).toBe(0)
    for (const cell of pieceCells(state.piece)) {
      expect(cell.x).toBeGreaterThanOrEqual(0)
      expect(cell.x).toBeLessThan(COLS)
    }
  })

  it('rotates a vertical I against the right wall without clipping', () => {
    const state = cleanState(6)
    expect(tryRotate(state)).toBe(true)
    if (!state.piece) throw new Error('missing piece')
    state.piece.x = COLS - 3
    expect(tryRotate(state)).toBe(true)
    if (!state.piece) throw new Error('missing piece')
    for (const cell of pieceCells(state.piece)) {
      expect(cell.x).toBeGreaterThanOrEqual(0)
      expect(cell.x).toBeLessThan(COLS)
    }
  })

  it('uses a y-offset kick when the floor blocks a rotation', () => {
    const state = cleanState(8)
    state.piece = createPiece('S')
    state.piece.y = TOTAL_ROWS - 2
    const before = state.piece
    expect(tryRotate(state)).toBe(true)
    if (!state.piece) throw new Error('missing piece')
    expect(state.piece).not.toBe(before)
    expect(state.piece.y).toBe(TOTAL_ROWS - 3)
    for (const cell of pieceCells(state.piece)) {
      expect(cell.y).toBeLessThan(TOTAL_ROWS)
      expect(cell.y).toBeGreaterThanOrEqual(0)
    }
  })

  it('refuses a rotation that would clip the stack', () => {
    const state = cleanState(9)
    state.piece = createPiece('T')
    const piece = state.piece
    const cells = pieceCells(piece)
    for (let y = 0; y <= 3; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!cells.some((cell) => cell.x === x && cell.y === y)) state.board[y][x] = 'I'
      }
    }
    expect(tryRotate(state)).toBe(false)
    expect(state.piece).toBe(piece)
  })

  it('maps clockwise rotation of spawn shapes correctly', () => {
    const spun = rotateCells(createPiece('I').cells, 4)
    expect(spun).toEqual([
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
      { x: 2, y: 3 },
    ])
  })

  it('scores one point per soft-drop cell', () => {
    const state = cleanState(10)
    const before = state.score
    expect(softDrop(state)).toBe(true)
    expect(state.score).toBe(before + 1)
    expect(softDrop(state)).toBe(true)
    expect(state.score).toBe(before + 2)
  })

  it('scores two points per hard-drop cell and lands on the floor', () => {
    const state = cleanState(10)
    const cells = hardDrop(state)
    expect(cells).toBeGreaterThan(10)
    expect(state.score).toBe(cells * 2)
    if (!state.piece) throw new Error('missing piece')
    expect(ghostY(state)).toBe(state.piece.y)
    expect(collides(state.board, { ...state.piece, y: state.piece.y + 1 })).toBe(true)
  })

  it('drops the ghost onto the stack landing row', () => {
    const state = cleanState(12)
    state.board[TOTAL_ROWS - 5][4] = 'L'
    if (!state.piece) throw new Error('missing piece')
    const landing = ghostY(state)
    expect(landing).toBeGreaterThan(state.piece.y)
    expect(collides(state.board, { ...state.piece, y: landing })).toBe(false)
    expect(collides(state.board, { ...state.piece, y: landing + 1 })).toBe(true)
  })
})

describe('tetris locking, clears and scoring', () => {
  it('merges the locked piece into the board and spawns the next one', () => {
    const state = cleanState(13)
    hardDrop(state)
    const kind = state.piece ? state.piece.kind : null
    expect(lockPiece(state, mulberry32(2))).toBe(0)
    expect(countFilled(state.board)).toBe(4)
    expect(state.piece).not.toBeNull()
    expect(state.canHold).toBe(true)
    expect(kind).not.toBeNull()
  })

  it('clears a completed line after the flash and shifts the stack down', () => {
    const state = cleanState(14)
    const bottom = TOTAL_ROWS - 1
    for (let x = 0; x < COLS - 1; x++) state.board[bottom][x] = 'I'
    state.piece = createPiece('I')
    state.piece.x = 6
    state.piece.y = bottom - 1
    expect(lockPiece(state, mulberry32(3))).toBe(1)
    expect(state.clearRows).toEqual([bottom])
    expect(state.lines).toBe(1)
    expect(state.level).toBe(1)
    expect(state.score).toBe(100)
    expect(state.board[bottom].every((cell) => cell !== null)).toBe(true)
    updateClear(state, 0.05, mulberry32(3))
    expect(state.clearRows).toHaveLength(1)
    updateClear(state, 0.12, mulberry32(3))
    expect(state.clearRows).toHaveLength(0)
    expect(state.board[bottom].every((cell) => cell !== null)).toBe(false)
    expect(state.piece).not.toBeNull()
  })

  it('scores a four-line clear as a Tetris', () => {
    const state = cleanState(15)
    for (let y = TOTAL_ROWS - 4; y < TOTAL_ROWS; y++) {
      for (let x = 0; x < COLS - 1; x++) state.board[y][x] = 'J'
    }
    const piece = createPiece('I')
    piece.cells = rotateCells(piece.cells, piece.box)
    piece.x = 7
    piece.y = TOTAL_ROWS - 4
    state.piece = piece
    expect(lockPiece(state, mulberry32(4))).toBe(4)
    expect(state.lines).toBe(4)
    expect(state.score).toBe(800)
    finishClear(state, mulberry32(4))
    expect(countFilled(state.board)).toBe(0)
    expect(state.piece).not.toBeNull()
  })

  it('applies the level multiplier to line scores', () => {
    expect(lineScore(1, 1)).toBe(100)
    expect(lineScore(2, 1)).toBe(300)
    expect(lineScore(3, 2)).toBe(1000)
    expect(lineScore(4, 3)).toBe(2400)
    expect(lineScore(5, 9)).toBe(0)
  })

  it('derives level from lines and speeds gravity up', () => {
    expect(levelForLines(0)).toBe(1)
    expect(levelForLines(9)).toBe(1)
    expect(levelForLines(10)).toBe(2)
    expect(levelForLines(100)).toBe(11)
    expect(gravityInterval(1)).toBeCloseTo(0.8, 5)
    expect(gravityInterval(2)).toBeCloseTo(0.74, 5)
    expect(gravityInterval(20)).toBe(0.05)
    expect(gravityInterval(200)).toBe(0.05)
    expect(gravityInterval(10)).toBeLessThan(gravityInterval(1))
  })

  it('ends the game when a spawned piece collides', () => {
    const state = cleanState(16)
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < COLS; x++) state.board[y][x] = 'L'
    }
    expect(spawnNext(state, mulberry32(5))).toBe(false)
    expect(state.gameOver).toBe(true)
  })
})

describe('tetris hold', () => {
  it('swaps the piece into an empty hold slot and blocks a second hold', () => {
    const state = cleanState(17)
    const first = state.piece ? state.piece.kind : null
    expect(holdPiece(state, mulberry32(6))).toBe(true)
    expect(state.hold).toBe(first)
    expect(state.canHold).toBe(false)
    expect(holdPiece(state, mulberry32(6))).toBe(false)
    expect(state.piece).not.toBeNull()
    if (!state.piece) return
    expect(state.piece.kind).not.toBe(first)
    hardDrop(state)
    lockPiece(state, mulberry32(6))
    if (state.clearRows.length > 0) finishClear(state, mulberry32(6))
    expect(state.canHold).toBe(true)
    const second = state.piece ? state.piece.kind : null
    expect(holdPiece(state, mulberry32(6))).toBe(true)
    expect(state.piece).not.toBeNull()
    if (!state.piece) return
    expect(state.piece.kind).toBe(first)
    expect(state.hold).toBe(second)
  })
})

interface Rig {
  args: GameCreateArgs
  sounds: SfxName[]
  hud: HudValue[][]
  scores: number[]
  over: { score: number }[]
  press(action: Action): void
  release(action: Action): void
  endFrame(): void
}

function makeRig(opts: { width?: number; height?: number; reducedMotion?: boolean } = {}): Rig {
  const held = new Set<Action>()
  const edges = new Set<Action>()
  const input: InputLike = {
    down: (_player, action) => held.has(action),
    pressed: (_player, action) => edges.has(action),
  }
  const sounds: SfxName[] = []
  const audio: AudioLike = {
    play: (name) => sounds.push(name),
    resume: () => undefined,
  }
  const hud: HudValue[][] = []
  const scores: number[] = []
  const over: { score: number }[] = []
  const events: GameEvents = {
    onScore: (score) => scores.push(score),
    onHud: (items) => hud.push(items),
    onGameOver: (result) => over.push(result),
  }
  const settings: GameSettings = {
    masterVolume: 1,
    musicVolume: 1,
    sfxVolume: 1,
    difficulty: 'normal',
    wrapWalls: false,
    leftHanded: false,
    reducedMotion: opts.reducedMotion ?? false,
    showControls: true,
  }
  const args: GameCreateArgs = {
    width: opts.width ?? 560,
    height: opts.height ?? 640,
    canvas: document.createElement('canvas'),
    input,
    audio,
    rng: mulberry32(2024),
    settings,
    events,
  }
  return {
    args,
    sounds,
    hud,
    scores,
    over,
    press(action) {
      held.add(action)
      edges.add(action)
    },
    release(action) {
      held.delete(action)
      edges.delete(action)
    },
    endFrame() {
      edges.clear()
    },
  }
}

function step(game: Game, rig: Rig, frames = 1): void {
  for (let i = 0; i < frames; i++) {
    game.update(1 / 60)
    rig.endFrame()
  }
}

function tap(game: Game, rig: Rig, action: Action): void {
  rig.press(action)
  game.update(1 / 60)
  rig.endFrame()
  rig.release(action)
}

function snapshot(game: Game): TetrisState {
  const state = game.serialize?.() as TetrisState | undefined
  if (!state) throw new Error('serialize missing')
  return state
}

function pieceX(game: Game): number {
  const piece = snapshot(game).piece
  return piece ? piece.x : -1
}

function stubCtx(): { ctx: CanvasRenderingContext2D; calls: () => number } {
  let ops = 0
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(_target, prop) {
      if (prop === 'measureText') return () => ({ width: 40 })
      if (typeof prop === 'symbol') return undefined
      return () => {
        ops++
        return undefined
      }
    },
    set() {
      ops++
      return true
    },
  }) as unknown as CanvasRenderingContext2D
  return { ctx, calls: () => ops }
}

describe('tetris engine', () => {
  it('emits the initial HUD with score, level and lines', () => {
    const rig = makeRig()
    create(rig.args)
    expect(rig.hud).toHaveLength(1)
    expect(rig.hud[0].map((item) => item.label)).toEqual(['Score', 'Level', 'Lines'])
    expect(rig.hud[0].map((item) => item.value)).toEqual([0, 1, 0])
    expect(rig.scores[0]).toBe(0)
  })

  it('renders a solid attract frame at thumb size after 30 idle updates', () => {
    const rig = makeRig({ width: 480, height: 320 })
    const game = create(rig.args)
    step(game, rig, 30)
    expect(rig.over).toHaveLength(0)
    expect(snapshot(game).attract).toBe(true)
    const { ctx, calls } = stubCtx()
    expect(() => game.render(ctx)).not.toThrow()
    expect(calls()).toBeGreaterThan(50)
  })

  it('clears the attract stack on the first input', () => {
    const rig = makeRig()
    const game = create(rig.args)
    expect(countFilled(snapshot(game).board)).toBeGreaterThan(10)
    tap(game, rig, 'left')
    expect(snapshot(game).attract).toBe(false)
    expect(countFilled(snapshot(game).board)).toBe(0)
    rig.press('action')
    game.update(1 / 60)
    rig.endFrame()
    expect(rig.scores.at(-1)).toBe(38)
    expect(rig.sounds).toContain('bounce')
  })

  it('repeats held movement after DAS delay, not before', () => {
    const rig = makeRig()
    const game = create(rig.args)
    tap(game, rig, 'left')
    step(game, rig, 1)
    const startX = pieceX(game)
    rig.press('left')
    game.update(1 / 60)
    rig.endFrame()
    const afterFirst = pieceX(game)
    expect(afterFirst).toBe(startX - 1)
    step(game, rig, 5)
    const beforeRepeat = pieceX(game)
    expect(beforeRepeat).toBe(afterFirst)
    step(game, rig, 12)
    const afterRepeat = pieceX(game)
    expect(afterRepeat).toBeLessThan(afterFirst)
    expect(rig.sounds.filter((name) => name === 'move').length).toBeGreaterThan(0)
  })

  it('rotates with the move sound', () => {
    const rig = makeRig()
    const game = create(rig.args)
    tap(game, rig, 'left')
    const before = snapshot(game).piece
    tap(game, rig, 'up')
    expect(rig.sounds).toContain('move')
    expect(snapshot(game).piece).not.toBe(before)
  })

  it('swaps hold once per lock with a click sound', () => {
    const rig = makeRig()
    const game = create(rig.args)
    tap(game, rig, 'left')
    tap(game, rig, 'special')
    expect(rig.sounds.filter((name) => name === 'click')).toHaveLength(1)
    tap(game, rig, 'special')
    expect(rig.sounds.filter((name) => name === 'click')).toHaveLength(1)
    rig.press('action')
    game.update(1 / 60)
    rig.endFrame()
    tap(game, rig, 'special')
    expect(rig.sounds.filter((name) => name === 'click')).toHaveLength(2)
  })

  it('soft drops while down is held and scores per cell', () => {
    const rig = makeRig()
    const game = create(rig.args)
    tap(game, rig, 'left')
    rig.press('down')
    step(game, rig, 30)
    rig.release('down')
    expect(rig.scores.at(-1)).toBeGreaterThanOrEqual(5)
    expect(rig.scores.at(-1)).toBeLessThan(45)
  })

  it('emits HUD changes when the score moves', () => {
    const rig = makeRig()
    const game = create(rig.args)
    const initial = rig.hud.length
    tap(game, rig, 'left')
    rig.press('action')
    game.update(1 / 60)
    rig.endFrame()
    expect(rig.hud.length).toBeGreaterThan(initial)
    expect(rig.hud.at(-1)?.[0].value).toBe(38)
    expect(rig.scores.at(-1)).toBe(38)
  })

  it('ends the game exactly once with a die sound', () => {
    const rig = makeRig({ reducedMotion: true })
    const game = create(rig.args)
    tap(game, rig, 'left')
    for (let i = 0; i < 400 && rig.over.length === 0; i++) {
      rig.press('action')
      game.update(1 / 60)
      rig.endFrame()
      rig.release('action')
    }
    expect(rig.over).toHaveLength(1)
    expect(rig.over[0].score).toBeGreaterThanOrEqual(0)
    expect(rig.sounds.filter((name) => name === 'die')).toHaveLength(1)
    game.update(1 / 60)
    expect(rig.over).toHaveLength(1)
  })

  it('renders the regular layout and survives destroy', () => {
    const rig = makeRig()
    const game = create(rig.args)
    const { ctx } = stubCtx()
    expect(() => game.render(ctx)).not.toThrow()
    game.destroy()
    expect(() => game.update(1 / 60)).not.toThrow()
    expect(() => game.render(ctx)).not.toThrow()
  })
})
