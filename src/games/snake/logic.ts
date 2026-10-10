import type { Rng } from '../../core/rng'

export const COLS = 20
export const ROWS = 20

export type Dir = 'up' | 'down' | 'left' | 'right'

export interface Cell {
  x: number
  y: number
}

export interface SnakeState {
  snake: Cell[] // head first
  dir: Dir
  queuedDir: Dir | null
  food: Cell
  score: number
  eaten: number
  alive: boolean
}

const DELTA: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
}

const OPPOSITE: Record<Dir, Dir> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
}

function spawnFood(rng: Rng, snake: Cell[], cols = COLS, rows = ROWS): Cell {
  const occupied = new Set(snake.map((c) => `${c.x},${c.y}`))
  const free: Cell[] = []
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y })
    }
  }
  if (free.length === 0) return { x: -1, y: -1 }
  return free[Math.floor(rng() * free.length)]
}

export function createInitialState(rng: Rng, cols = COLS, rows = ROWS): SnakeState {
  const cy = Math.floor(rows / 2)
  const snake: Cell[] = [
    { x: 4, y: cy },
    { x: 3, y: cy },
    { x: 2, y: cy },
  ]
  return {
    snake,
    dir: 'right',
    queuedDir: null,
    food: spawnFood(rng, snake, cols, rows),
    score: 0,
    eaten: 0,
    alive: true,
  }
}

export function queueDirection(state: SnakeState, dir: Dir): SnakeState {
  const effective = state.queuedDir ?? state.dir
  if (dir === effective || dir === OPPOSITE[effective]) return state
  return { ...state, queuedDir: dir }
}

export interface StepOptions {
  wrap: boolean
  cols?: number
  rows?: number
}

export function step(state: SnakeState, rng: Rng, opts: StepOptions): SnakeState {
  if (!state.alive) return state
  const cols = opts.cols ?? COLS
  const rows = opts.rows ?? ROWS

  const dir = state.queuedDir ?? state.dir
  const head = state.snake[0]
  let next: Cell = { x: head.x + DELTA[dir].x, y: head.y + DELTA[dir].y }

  if (opts.wrap) {
    next = { x: (next.x + cols) % cols, y: (next.y + rows) % rows }
  } else if (next.x < 0 || next.y < 0 || next.x >= cols || next.y >= rows) {
    return { ...state, dir, queuedDir: null, alive: false }
  }

  const ate = next.x === state.food.x && next.y === state.food.y
  const body = ate ? state.snake : state.snake.slice(0, -1)
  if (body.some((c) => c.x === next.x && c.y === next.y)) {
    return { ...state, dir, queuedDir: null, alive: false }
  }

  const snake = [next, ...state.snake]
  if (!ate) snake.pop()

  return {
    ...state,
    snake,
    dir,
    queuedDir: null,
    food: ate ? spawnFood(rng, snake, cols, rows) : state.food,
    score: ate ? state.score + 10 : state.score,
    eaten: ate ? state.eaten + 1 : state.eaten,
    alive: true,
  }
}

/** Moves per second — ramps with score, scaled by difficulty. */
export function speedFor(score: number, difficulty: 'easy' | 'normal' | 'hard'): number {
  const base = { easy: 6.5, normal: 7.5, hard: 9 }[difficulty]
  const ramp = Math.min(8, Math.floor(score / 50) * 1.1)
  return base + ramp
}
