import type { Rng } from '../../core/rng'
import type { Difficulty, SfxName } from '../../core/types'

export const COLS = 8
export const ROWS = 5
export const ROW_COLORS = ['#f87171', '#fb9234', '#facc15', '#4ade80', '#38bdf8']
export const BALL_RADIUS = 7
export const MAX_BALLS = 4
export const POWER_CHANCE = 0.12
export const WIDE_SCALE = 1.4
export const WIDE_DURATION = 10
export const MAX_REBOUND = Math.PI / 3
export const MIN_VY = 0.45

const SUB_DT = 1 / 240
const MAX_SUBSTEPS = 96
const SPEED_RAMP = 1.012
const SPEED_CAP = 1.75
const LEVEL_BUMP = 0.05
const HEIGHT_SPEED = 0.54
const HEIGHT_POWER_FALL = 0.3
const PADDLE_RATIO: Record<Difficulty, number> = { easy: 0.3, normal: 0.24, hard: 0.17 }
const SPEED_SCALE: Record<Difficulty, number> = { easy: 0.82, normal: 1, hard: 1.22 }

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface BrickLayout {
  left: number
  top: number
  brickW: number
  brickH: number
  gap: number
}

export interface Brick {
  col: number
  row: number
  hp: number
  maxHp: number
  alive: boolean
  color: string
}

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
}

export type PowerType = 'wide' | 'multi'

export interface PowerUp {
  x: number
  y: number
  vy: number
  w: number
  h: number
  type: PowerType
}

export interface PlayState {
  w: number
  h: number
  paddleX: number
  paddleY: number
  paddleW: number
  paddleH: number
  basePaddleW: number
  balls: Ball[]
  bricks: Brick[]
  powerups: PowerUp[]
  score: number
  lives: number
  level: number
  speed: number
  baseSpeed: number
  serveTimer: number
  wideTimer: number
  over: boolean
}

export interface StepOptions {
  rng: Rng
  serveDelay: number
}

export interface StepResult {
  state: PlayState
  sfx: SfxName[]
  scoreChanged: boolean
  lifeLost: boolean
  levelCleared: boolean
  gameOver: boolean
}

export interface CreateOptions {
  width: number
  height: number
  difficulty: Difficulty
  rng: Rng
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function sideMargin(w: number): number {
  return Math.max(8, w * 0.032)
}

export function brickLayout(w: number, h: number): BrickLayout {
  const gap = Math.max(3, h * 0.008)
  const brickH = Math.max(12, Math.min(22, h * 0.036))
  const usable = Math.max(80, w - sideMargin(w) * 2)
  const brickW = (usable - gap * (COLS - 1)) / COLS
  const top = Math.max(24, h * 0.1)
  return { left: sideMargin(w), top, brickW, brickH, gap }
}

export function brickRect(layout: BrickLayout, col: number, row: number): Rect {
  return {
    x: layout.left + col * (layout.brickW + layout.gap),
    y: layout.top + row * (layout.brickH + layout.gap),
    w: layout.brickW,
    h: layout.brickH,
  }
}

export function wallBottom(layout: BrickLayout): number {
  return layout.top + ROWS * layout.brickH + (ROWS - 1) * layout.gap
}

export function paddleHeight(h: number): number {
  return Math.max(10, Math.min(18, h * 0.026))
}

export function paddleSpeed(w: number): number {
  return w * 1.6
}

export function powerupSize(w: number): { w: number; h: number } {
  return { w: Math.max(24, Math.min(34, w * 0.07)), h: 14 }
}

function tint(hex: string, amount: number): string {
  const mix = (v: number): string =>
    Math.round(v + (255 - v) * amount * 0.25)
      .toString(16)
      .padStart(2, '0')
  return `#${mix(parseInt(hex.slice(1, 3), 16))}${mix(parseInt(hex.slice(3, 5), 16))}${mix(
    parseInt(hex.slice(5, 7), 16),
  )}`
}

function isPresent(level: number, col: number, row: number): boolean {
  switch ((level - 1) % 5) {
    case 1:
      return !(row % 2 === 1 && col % 2 === 1)
    case 2:
      return (col + row) % 4 !== 3
    case 3:
      return (col + row) % 3 !== 0
    case 4:
      return col + row >= 2 && COLS - 1 - col + row >= 2
    default:
      return true
  }
}

export function generateBricks(level: number, rng: Rng): Brick[] {
  const bricks: Brick[] = []
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (!isPresent(level, col, row)) continue
      const hp = row === 0 && level >= 2 ? 2 : 1
      bricks.push({ col, row, hp, maxHp: hp, alive: true, color: tint(ROW_COLORS[row], rng()) })
    }
  }
  return bricks
}

export function createPlayState(opts: CreateOptions): PlayState {
  const { width, height, difficulty, rng } = opts
  const layout = brickLayout(width, height)
  const basePaddleW = Math.max(56, width * PADDLE_RATIO[difficulty])
  const baseSpeed = height * HEIGHT_SPEED * SPEED_SCALE[difficulty]
  const ph = paddleHeight(height)
  const paddleY = height - Math.max(16, height * 0.05) - ph
  const angle = Math.PI / 7
  const startY = Math.max(height * 0.38, wallBottom(layout) + BALL_RADIUS * 2 + height * 0.05)
  return {
    w: width,
    h: height,
    paddleX: width / 2,
    paddleY,
    paddleW: basePaddleW,
    paddleH: ph,
    basePaddleW,
    balls: [
      {
        x: width / 2,
        y: startY,
        vx: baseSpeed * Math.sin(angle),
        vy: baseSpeed * Math.cos(angle),
      },
    ],
    bricks: generateBricks(1, rng),
    powerups: [],
    score: 0,
    lives: 3,
    level: 1,
    speed: baseSpeed,
    baseSpeed,
    serveTimer: 0,
    wideTimer: 0,
    over: false,
  }
}

function copyState(s: PlayState): PlayState {
  return {
    ...s,
    balls: s.balls.map((b) => ({ ...b })),
    bricks: s.bricks.map((b) => ({ ...b })),
    powerups: s.powerups.map((p) => ({ ...p })),
  }
}

function clampPaddle(state: PlayState, x: number): number {
  const half = state.paddleW / 2
  return clamp(x, half, Math.max(half, state.w - half))
}

export function setPaddle(state: PlayState, centerX: number): PlayState {
  const x = clampPaddle(state, centerX)
  return x === state.paddleX ? state : { ...state, paddleX: x }
}

export function movePaddle(state: PlayState, dx: number): PlayState {
  return setPaddle(state, state.paddleX + dx)
}

function applySpeed(ball: Ball, speed: number): void {
  if (speed < 1e-6) return
  const mag = Math.hypot(ball.vx, ball.vy)
  if (mag < 1e-6) {
    ball.vx = 0
    ball.vy = -speed
    return
  }
  let ux = ball.vx / mag
  let uy = ball.vy / mag
  if (Math.abs(uy) < MIN_VY) {
    uy = uy <= 0 ? -MIN_VY : MIN_VY
    ux = (ux < 0 ? -1 : 1) * Math.sqrt(Math.max(0, 1 - uy * uy))
    const n = Math.hypot(ux, uy) || 1
    ux /= n
    uy /= n
  }
  ball.vx = ux * speed
  ball.vy = uy * speed
}

function rescaleBalls(state: PlayState): void {
  for (const b of state.balls) applySpeed(b, state.speed)
}

function parkBalls(state: PlayState): void {
  const n = state.balls.length
  const top = state.paddleY - BALL_RADIUS - 3
  state.balls.forEach((b, i) => {
    const offset = (i - (n - 1) / 2) * (BALL_RADIUS * 3)
    b.x = clamp(state.paddleX + offset, BALL_RADIUS, state.w - BALL_RADIUS)
    b.y = top
  })
}

function launchBalls(state: PlayState, rng: Rng): void {
  for (const b of state.balls) {
    const a = (rng() * 2 - 1) * (Math.PI / 5.5)
    b.vx = state.speed * Math.sin(a)
    b.vy = -state.speed * Math.cos(a)
  }
}

function spawnBall(state: PlayState): void {
  state.balls.push({
    x: state.paddleX,
    y: state.paddleY - BALL_RADIUS - 3,
    vx: 0,
    vy: -state.speed,
  })
}

function startServe(state: PlayState, rng: Rng, delay: number, sfx: SfxName[]): void {
  state.serveTimer = delay
  parkBalls(state)
  if (delay <= 0) {
    state.serveTimer = 0
    launchBalls(state, rng)
    sfx.push('start')
  }
}

function applyPower(state: PlayState, p: PowerUp): void {
  if (p.type === 'wide') {
    state.wideTimer = WIDE_DURATION
    state.paddleW = state.basePaddleW * WIDE_SCALE
    state.paddleX = clampPaddle(state, state.paddleX)
    return
  }
  if (state.balls.length === 0 || state.balls.length >= MAX_BALLS) return
  const src = state.balls[0]
  const a = (src.vx >= 0 ? -1 : 1) * (Math.PI / 6)
  state.balls.push({
    x: clamp(src.x, BALL_RADIUS, state.w - BALL_RADIUS),
    y: Math.min(state.h - BALL_RADIUS, src.y + BALL_RADIUS * 3),
    vx: state.speed * Math.sin(a),
    vy: -state.speed * Math.cos(a),
  })
}

function stepPowerups(state: PlayState, dt: number, sfx: SfxName[]): void {
  const kept: PowerUp[] = []
  for (const p of state.powerups) {
    p.y += p.vy * dt
    if (p.y - p.h / 2 > state.h) continue
    const half = state.paddleW / 2
    const hitY = p.y + p.h / 2 >= state.paddleY && p.y - p.h / 2 <= state.paddleY + state.paddleH
    const hitX = p.x >= state.paddleX - half && p.x <= state.paddleX + half
    if (hitX && hitY) {
      applyPower(state, p)
      sfx.push('click')
      continue
    }
    kept.push(p)
  }
  state.powerups = kept
}

function collideWalls(ball: Ball, w: number): boolean {
  let hit = false
  if (ball.x - BALL_RADIUS < 0) {
    ball.x = BALL_RADIUS
    ball.vx = Math.abs(ball.vx)
    hit = true
  } else if (ball.x + BALL_RADIUS > w) {
    ball.x = w - BALL_RADIUS
    ball.vx = -Math.abs(ball.vx)
    hit = true
  }
  if (ball.y - BALL_RADIUS < 0) {
    ball.y = BALL_RADIUS
    ball.vy = Math.abs(ball.vy)
    hit = true
  }
  return hit
}

function collidePaddle(ball: Ball, state: PlayState): boolean {
  if (ball.vy <= 0) return false
  const half = state.paddleW / 2
  if (ball.y + BALL_RADIUS < state.paddleY) return false
  if (ball.y - BALL_RADIUS > state.paddleY + state.paddleH) return false
  if (ball.x < state.paddleX - half || ball.x > state.paddleX + half) return false
  ball.y = state.paddleY - BALL_RADIUS
  const rel = clamp((ball.x - state.paddleX) / half, -1, 1)
  const speed = Math.hypot(ball.vx, ball.vy) || state.speed
  const a = rel * MAX_REBOUND
  ball.vx = speed * Math.sin(a)
  ball.vy = -speed * Math.cos(a)
  return true
}

function findBrickHit(state: PlayState, ball: Ball): number {
  const layout = brickLayout(state.w, state.h)
  for (let i = 0; i < state.bricks.length; i++) {
    const b = state.bricks[i]
    if (!b.alive) continue
    const r = brickRect(layout, b.col, b.row)
    const cx = clamp(ball.x, r.x, r.x + r.w)
    const cy = clamp(ball.y, r.y, r.y + r.h)
    const dx = ball.x - cx
    const dy = ball.y - cy
    if (dx * dx + dy * dy <= BALL_RADIUS * BALL_RADIUS) return i
  }
  return -1
}

function resolveBrick(ball: Ball, r: Rect): void {
  const cx = clamp(ball.x, r.x, r.x + r.w)
  const cy = clamp(ball.y, r.y, r.y + r.h)
  const dx = ball.x - cx
  const dy = ball.y - cy
  if (dx !== 0 || dy !== 0) {
    if (Math.abs(dx) > Math.abs(dy)) {
      ball.x = cx + (dx > 0 ? BALL_RADIUS : -BALL_RADIUS)
      ball.vx = dx > 0 ? Math.abs(ball.vx) : -Math.abs(ball.vx)
    } else {
      ball.y = cy + (dy > 0 ? BALL_RADIUS : -BALL_RADIUS)
      ball.vy = dy > 0 ? Math.abs(ball.vy) : -Math.abs(ball.vy)
    }
    return
  }
  const left = ball.x - r.x
  const right = r.x + r.w - ball.x
  const top = ball.y - r.y
  const bottom = r.y + r.h - ball.y
  const m = Math.min(left, right, top, bottom)
  if (m === left) {
    ball.x = r.x - BALL_RADIUS
    ball.vx = -Math.abs(ball.vx)
  } else if (m === right) {
    ball.x = r.x + r.w + BALL_RADIUS
    ball.vx = Math.abs(ball.vx)
  } else if (m === top) {
    ball.y = r.y - BALL_RADIUS
    ball.vy = -Math.abs(ball.vy)
  } else {
    ball.y = r.y + r.h + BALL_RADIUS
    ball.vy = Math.abs(ball.vy)
  }
}

export function damageBrick(state: PlayState, index: number, rng: Rng): PlayState {
  const target = state.bricks[index]
  if (!target || !target.alive) return state
  const next = copyState(state)
  const brick = next.bricks[index]
  brick.hp -= 1
  if (brick.hp > 0) return next
  brick.alive = false
  next.score += 10 * next.level
  next.speed = Math.min(next.speed * SPEED_RAMP, next.baseSpeed * SPEED_CAP)
  rescaleBalls(next)
  if (rng() < POWER_CHANCE) {
    const rect = brickRect(brickLayout(next.w, next.h), brick.col, brick.row)
    const size = powerupSize(next.w)
    next.powerups.push({
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h / 2,
      vy: next.h * HEIGHT_POWER_FALL,
      w: size.w,
      h: size.h,
      type: rng() < 0.5 ? 'wide' : 'multi',
    })
  }
  return next
}

function stepBalls(state: PlayState, dt: number, rng: Rng, sfx: SfxName[]): PlayState {
  let next = state
  let remaining = dt
  let guard = 0
  while (remaining > 1e-9 && guard < MAX_SUBSTEPS) {
    const h = Math.min(SUB_DT, remaining)
    remaining -= h
    guard++
    for (let bi = 0; bi < next.balls.length; bi++) {
      const ball = next.balls[bi]
      ball.x += ball.vx * h
      ball.y += ball.vy * h
      if (collideWalls(ball, next.w)) sfx.push('wall')
      if (collidePaddle(ball, next)) sfx.push('bounce')
      const idx = findBrickHit(next, ball)
      if (idx >= 0) {
        const layout = brickLayout(next.w, next.h)
        resolveBrick(ball, brickRect(layout, next.bricks[idx].col, next.bricks[idx].row))
        next = damageBrick(next, idx, rng)
        applySpeed(next.balls[bi], Math.hypot(next.balls[bi].vx, next.balls[bi].vy))
        continue
      }
      applySpeed(ball, Math.hypot(ball.vx, ball.vy))
    }
  }
  return next
}

export function step(state: PlayState, dt: number, opts: StepOptions): StepResult {
  const noop: StepResult = {
    state,
    sfx: [],
    scoreChanged: false,
    lifeLost: false,
    levelCleared: false,
    gameOver: false,
  }
  if (state.over || dt <= 0) return noop
  const startScore = state.score
  let next = copyState(state)
  const sfx: SfxName[] = []
  let lifeLost = false
  let levelCleared = false
  let gameOver = false

  if (next.wideTimer > 0) {
    next.wideTimer = Math.max(0, next.wideTimer - dt)
    if (next.wideTimer === 0) {
      next.paddleW = next.basePaddleW
      next.paddleX = clampPaddle(next, next.paddleX)
    }
  }

  if (next.serveTimer > 0) {
    next.serveTimer = Math.max(0, next.serveTimer - dt)
    parkBalls(next)
    if (next.serveTimer === 0) {
      launchBalls(next, opts.rng)
      sfx.push('start')
    }
  }

  stepPowerups(next, dt, sfx)

  if (next.serveTimer <= 0) {
    next = stepBalls(next, dt, opts.rng, sfx)
    const before = next.balls.length
    next.balls = next.balls.filter((b) => b.y - BALL_RADIUS <= next.h)
    if (before > 0 && next.balls.length === 0) {
      lifeLost = true
      sfx.push('die')
      next.lives -= 1
      if (next.lives <= 0) {
        next.lives = 0
        next.over = true
        gameOver = true
      } else {
        spawnBall(next)
        startServe(next, opts.rng, opts.serveDelay, sfx)
      }
    }
  }

  if (!gameOver && next.balls.length > 0 && !next.bricks.some((b) => b.alive)) {
    levelCleared = true
    sfx.push('clear')
    next.score += 50
    next.level += 1
    next.bricks = generateBricks(next.level, opts.rng)
    next.speed = next.baseSpeed * (1 + (next.level - 1) * LEVEL_BUMP)
    rescaleBalls(next)
    startServe(next, opts.rng, opts.serveDelay, sfx)
  }

  return {
    state: next,
    sfx: [...new Set(sfx)],
    scoreChanged: next.score !== startScore,
    lifeLost,
    levelCleared,
    gameOver,
  }
}
