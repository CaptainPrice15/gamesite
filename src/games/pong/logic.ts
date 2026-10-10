import type { Difficulty } from '../../core/types'

export const PADDLE_MARGIN = 24
export const PADDLE_WIDTH = 10
export const PADDLE_SPEED = 340
export const WIN_SCORE = 11
export const SERVE_TIME = 1
export const SERVE_TICK = 0.5
export const SERVE_ANGLE = (20 * Math.PI) / 180
export const MAX_BOUNCE_ANGLE = (65 * Math.PI) / 180
export const SPEED_GAIN = 1.04
export const SPEED_CAP = 1.6
export const MAX_SUBSTEP = 1 / 240

export interface Ball {
  x: number
  y: number
  vx: number
  vy: number
}

export type Phase = 'serve' | 'play' | 'over'
export type Winner = 'p1' | 'p2'

export interface PongState {
  width: number
  height: number
  radius: number
  paddle1Y: number
  paddle2Y: number
  paddleH: number
  ball: Ball
  score1: number
  score2: number
  phase: Phase
  serveTimer: number
  serveTick: number
  serveDir: 1 | -1
  winner: Winner | null
  baseSpeed: number
  speed: number
  hits: number
}

export interface StepInput {
  dir: number
  target?: number
}

export interface StepOptions {
  p1: StepInput
  p2: StepInput
  reducedMotion?: boolean
  rng?: () => number
}

export type StepEvent = 'wall' | 'paddle' | 'score' | 'tick' | 'win'

export interface StepResult {
  state: PongState
  events: StepEvent[]
}

export interface Tune {
  ballSpeed: number
  paddleH: number
}

const TUNE: Record<Difficulty, Tune> = {
  easy: { ballSpeed: 265, paddleH: 118 },
  normal: { ballSpeed: 325, paddleH: 88 },
  hard: { ballSpeed: 390, paddleH: 62 },
}

export function tuneFor(difficulty: Difficulty): Tune {
  return TUNE[difficulty]
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clampPaddle(y: number, paddleH: number, height: number): number {
  const half = paddleH / 2
  return clamp(y, half, height - half)
}

export function paddleCenterX(state: PongState, side: 0 | 1): number {
  return side === 0
    ? PADDLE_MARGIN + PADDLE_WIDTH / 2
    : state.width - PADDLE_MARGIN - PADDLE_WIDTH / 2
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function paddleRect(state: PongState, side: 0 | 1): Rect {
  const h = state.paddleH
  const cy = side === 0 ? state.paddle1Y : state.paddle2Y
  return {
    x: paddleCenterX(state, side) - PADDLE_WIDTH / 2,
    y: cy - h / 2,
    w: PADDLE_WIDTH,
    h,
  }
}

export function angleForOffset(offset: number): number {
  return clamp(offset, -1, 1) * MAX_BOUNCE_ANGLE
}

export function nextSpeed(speed: number, baseSpeed: number): number {
  return Math.min(baseSpeed * SPEED_CAP, speed * SPEED_GAIN)
}

export function createInitialState(
  width: number,
  height: number,
  difficulty: Difficulty,
  rng: () => number,
  reducedMotion = false,
): PongState {
  const tune = TUNE[difficulty]
  const paddleH = Math.min(tune.paddleH, height * 0.6)
  const dir: 1 | -1 = rng() < 0.5 ? -1 : 1
  return {
    width,
    height,
    radius: clamp(height * 0.02, 5, 10),
    paddle1Y: height / 2,
    paddle2Y: height / 2,
    paddleH,
    ball: { x: width / 2, y: height / 2, vx: 0, vy: 0 },
    score1: 0,
    score2: 0,
    phase: 'serve',
    serveTimer: reducedMotion ? 0 : SERVE_TIME,
    serveTick: 0,
    serveDir: dir,
    winner: null,
    baseSpeed: tune.ballSpeed,
    speed: tune.ballSpeed,
    hits: 0,
  }
}

export function step(state: PongState, dt: number, opts: StepOptions): StepResult {
  const events: StepEvent[] = []
  if (state.phase === 'over' || dt <= 0) return { state, events }

  const p1 = movePaddle(state, 0, opts.p1, dt)
  const p2 = movePaddle(state, 1, opts.p2, dt)
  let current: PongState =
    p1 === state.paddle1Y && p2 === state.paddle2Y
      ? state
      : { ...state, paddle1Y: p1, paddle2Y: p2 }

  if (current.phase === 'serve') return serveStep(current, dt, opts, events)

  let remaining = dt
  while (remaining > 0 && current.phase === 'play') {
    const h = Math.min(remaining, MAX_SUBSTEP)
    remaining -= h
    current = advance(current, h, opts, events)
  }
  return { state: current, events }
}

function movePaddle(state: PongState, side: 0 | 1, input: StepInput, dt: number): number {
  const current = side === 0 ? state.paddle1Y : state.paddle2Y
  if (input.target !== undefined) return clampPaddle(input.target, state.paddleH, state.height)
  const dir = clamp(input.dir, -1, 1)
  return clampPaddle(current + dir * PADDLE_SPEED * dt, state.paddleH, state.height)
}

function serveStep(
  state: PongState,
  dt: number,
  opts: StepOptions,
  events: StepEvent[],
): StepResult {
  const timer = state.serveTimer - dt
  if (timer <= 0) return { state: launch(state, opts), events }
  const tick = Math.ceil(timer / SERVE_TICK)
  if (tick !== state.serveTick) events.push('tick')
  return { state: { ...state, serveTimer: timer, serveTick: tick }, events }
}

function launch(state: PongState, opts: StepOptions): PongState {
  const angle = opts.rng ? (opts.rng() * 2 - 1) * SERVE_ANGLE : 0
  const speed = state.baseSpeed
  return {
    ...state,
    phase: 'play',
    serveTimer: 0,
    serveTick: 0,
    speed,
    ball: {
      x: state.width / 2,
      y: state.height / 2,
      vx: state.serveDir * speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
    },
  }
}

function advance(state: PongState, h: number, opts: StepOptions, events: StepEvent[]): PongState {
  const b = state.ball
  let next: PongState = {
    ...state,
    ball: { x: b.x + b.vx * h, y: b.y + b.vy * h, vx: b.vx, vy: b.vy },
  }

  if (next.ball.y - next.radius < 0) {
    next = { ...next, ball: { ...next.ball, y: next.radius, vy: -next.ball.vy } }
    events.push('wall')
  } else if (next.ball.y + next.radius > next.height) {
    next = { ...next, ball: { ...next.ball, y: next.height - next.radius, vy: -next.ball.vy } }
    events.push('wall')
  }

  if (next.ball.vx < 0 && overlapsPaddle(next, 0)) {
    next = deflect(next, 0)
    events.push('paddle')
  } else if (next.ball.vx > 0 && overlapsPaddle(next, 1)) {
    next = deflect(next, 1)
    events.push('paddle')
  }

  if (next.ball.x + next.radius < 0) return scorePoint(next, 1, opts, events)
  if (next.ball.x - next.radius > next.width) return scorePoint(next, 0, opts, events)
  return next
}

function overlapsPaddle(state: PongState, side: 0 | 1): boolean {
  const rect = paddleRect(state, side)
  const b = state.ball
  return (
    b.x - state.radius <= rect.x + rect.w &&
    b.x + state.radius >= rect.x &&
    b.y + state.radius >= rect.y &&
    b.y - state.radius <= rect.y + rect.h
  )
}

function deflect(state: PongState, side: 0 | 1): PongState {
  const half = state.paddleH / 2
  const cy = side === 0 ? state.paddle1Y : state.paddle2Y
  const angle = angleForOffset((state.ball.y - cy) / half)
  const speed = nextSpeed(state.speed, state.baseSpeed)
  const dir: 1 | -1 = side === 0 ? 1 : -1
  const face = paddleCenterX(state, side) + dir * (PADDLE_WIDTH / 2)
  return {
    ...state,
    speed,
    hits: state.hits + 1,
    ball: {
      x: face + dir * state.radius,
      y: state.ball.y,
      vx: dir * speed * Math.cos(angle),
      vy: speed * Math.sin(angle),
    },
  }
}

function scorePoint(
  state: PongState,
  scorer: 0 | 1,
  opts: StepOptions,
  events: StepEvent[],
): PongState {
  events.push('score')
  const score1 = state.score1 + (scorer === 0 ? 1 : 0)
  const score2 = state.score2 + (scorer === 1 ? 1 : 0)
  const reset: PongState = {
    ...state,
    score1,
    score2,
    ball: { x: state.width / 2, y: state.height / 2, vx: 0, vy: 0 },
    speed: state.baseSpeed,
    hits: 0,
    serveTick: 0,
  }
  if (score1 >= WIN_SCORE || score2 >= WIN_SCORE) {
    events.push('win')
    return {
      ...reset,
      phase: 'over',
      winner: score1 > score2 ? 'p1' : 'p2',
      serveTimer: 0,
    }
  }
  const conceder: 0 | 1 = scorer === 0 ? 1 : 0
  const serveDir: 1 | -1 = conceder === 0 ? -1 : 1
  const served: PongState = { ...reset, serveDir, phase: 'serve' }
  if (opts.reducedMotion) return launch(served, opts)
  return { ...served, serveTimer: SERVE_TIME }
}

export interface PongSnap {
  x: number
  y: number
  vx: number
  vy: number
  p1: number
  p2: number
  s1: number
  s2: number
  ph: Phase
  st: number
  sd: 1 | -1
  w: Winner | null
  h: number
  sp: number
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function encodeSnap(state: PongState): PongSnap {
  return {
    x: round1(state.ball.x),
    y: round1(state.ball.y),
    vx: round1(state.ball.vx),
    vy: round1(state.ball.vy),
    p1: round1(state.paddle1Y),
    p2: round1(state.paddle2Y),
    s1: state.score1,
    s2: state.score2,
    ph: state.phase,
    st: round1(state.serveTimer),
    sd: state.serveDir,
    w: state.winner,
    h: state.paddleH,
    sp: round1(state.speed),
  }
}

function isPhase(value: unknown): value is Phase {
  return value === 'serve' || value === 'play' || value === 'over'
}

function isSide(value: unknown): value is 1 | -1 {
  return value === 1 || value === -1
}

function isNum(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseSnap(raw: unknown): PongSnap | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!isNum(r.x) || !isNum(r.y) || !isNum(r.vx) || !isNum(r.vy)) return null
  if (!isNum(r.p1) || !isNum(r.p2) || !isNum(r.s1) || !isNum(r.s2)) return null
  if (!isPhase(r.ph) || !isNum(r.st) || !isSide(r.sd)) return null
  if (!isNum(r.h) || !isNum(r.sp)) return null
  if (r.w !== null && r.w !== 'p1' && r.w !== 'p2') return null
  if (!Number.isInteger(r.s1) || !Number.isInteger(r.s2)) return null
  if (r.s1 < 0 || r.s2 < 0) return null
  return {
    x: r.x,
    y: r.y,
    vx: r.vx,
    vy: r.vy,
    p1: r.p1,
    p2: r.p2,
    s1: r.s1,
    s2: r.s2,
    ph: r.ph,
    st: r.st,
    sd: r.sd,
    w: r.w,
    h: r.h,
    sp: r.sp,
  }
}

export function applySnap(state: PongState, snap: PongSnap): PongState {
  return {
    ...state,
    ball: { x: snap.x, y: snap.y, vx: snap.vx, vy: snap.vy },
    paddle1Y: clampPaddle(snap.p1, snap.h, state.height),
    paddle2Y: clampPaddle(snap.p2, snap.h, state.height),
    paddleH: snap.h,
    score1: snap.s1,
    score2: snap.s2,
    phase: snap.ph,
    serveTimer: snap.st,
    serveDir: snap.sd,
    winner: snap.w,
    speed: snap.sp,
  }
}

export function extrapolateBall(state: PongState, seconds: number): { x: number; y: number } {
  if (state.phase !== 'play') return { x: state.ball.x, y: state.ball.y }
  const t = clamp(seconds, 0, 0.15)
  return {
    x: clamp(state.ball.x + state.ball.vx * t, state.radius, state.width - state.radius),
    y: clamp(state.ball.y + state.ball.vy * t, state.radius, state.height - state.radius),
  }
}
