import { describe, expect, it } from 'vitest'
import {
  MAX_BOUNCE_ANGLE,
  SERVE_TIME,
  WIN_SCORE,
  angleForOffset,
  applySnap,
  clampPaddle,
  createInitialState,
  encodeSnap,
  extrapolateBall,
  nextSpeed,
  parseSnap,
  paddleRect,
  step,
  tuneFor,
  type PongState,
  type StepEvent,
  type StepOptions,
} from './logic'

const rng = () => 0.5
const idle: StepOptions = { p1: { dir: 0 }, p2: { dir: 0 } }

function baseState(over: Partial<PongState> = {}): PongState {
  return { ...createInitialState(640, 400, 'normal', rng), ...over }
}

describe('pong logic', () => {
  it('starts centered with a one second serve countdown', () => {
    const s = createInitialState(640, 400, 'normal', rng)
    expect(s.ball).toEqual({ x: 320, y: 200, vx: 0, vy: 0 })
    expect(s.phase).toBe('serve')
    expect(s.serveTimer).toBe(SERVE_TIME)
    expect(s.serveDir).toBe(1)
    expect(s.score1).toBe(0)
    expect(s.score2).toBe(0)
    expect(s.paddle1Y).toBe(200)
    expect(s.paddle2Y).toBe(200)
    expect(s.winner).toBeNull()
    expect(s.radius).toBe(8)
    expect(s.paddleH).toBe(tuneFor('normal').paddleH)
  })

  it('skips the countdown under reduced motion', () => {
    const s = createInitialState(640, 400, 'normal', rng, true)
    expect(s.serveTimer).toBe(0)
    const r = step(s, 1 / 60, { ...idle, rng })
    expect(r.state.phase).toBe('play')
    expect(r.events).not.toContain('tick')
    expect(r.state.ball.vx).toBeGreaterThan(0)
  })

  it('ticks through the countdown then serves toward the conceding side', () => {
    const s = baseState()
    const first = step(s, 1 / 60, idle)
    expect(first.events).toContain('tick')
    expect(first.state.phase).toBe('serve')

    const mid = step(first.state, 0.6, idle)
    expect(mid.events).toContain('tick')
    expect(mid.state.serveTimer).toBeCloseTo(SERVE_TIME - 1 / 60 - 0.6)

    const served = step(mid.state, 0.5, idle)
    expect(served.state.phase).toBe('play')
    expect(served.state.serveTimer).toBe(0)
    expect(served.state.ball.vx).toBeGreaterThan(0)
    expect(Math.abs(served.state.ball.vx)).toBeCloseTo(served.state.baseSpeed)
    expect(served.events).not.toContain('tick')
  })

  it('clamps paddles to the field', () => {
    expect(clampPaddle(-50, 88, 400)).toBe(44)
    expect(clampPaddle(500, 88, 400)).toBe(356)
    const s = baseState()
    expect(step(s, 5, { p1: { dir: 1 }, p2: { dir: 0 } }).state.paddle1Y).toBe(356)
    expect(step(s, 5, { p1: { dir: -1 }, p2: { dir: 0 } }).state.paddle1Y).toBe(44)
    expect(step(s, 5, { p1: { dir: 0 }, p2: { dir: -1 } }).state.paddle2Y).toBe(44)
  })

  it('snaps a paddle to a pointer target, clamped', () => {
    const r = step(baseState(), 1 / 60, {
      p1: { dir: -1, target: 120 },
      p2: { dir: 1, target: 9999 },
    })
    expect(r.state.paddle1Y).toBe(120)
    expect(r.state.paddle2Y).toBe(356)
  })

  it('ignores a non-positive dt', () => {
    const s = baseState()
    const r = step(s, 0, idle)
    expect(r.state).toBe(s)
    expect(r.events).toHaveLength(0)
  })

  it('bounces off the top and bottom walls', () => {
    const top = step(
      baseState({ phase: 'play', serveTimer: 0, ball: { x: 320, y: 4, vx: 200, vy: -300 } }),
      1 / 240,
      idle,
    )
    expect(top.events).toContain('wall')
    expect(top.state.ball.vy).toBeGreaterThan(0)
    expect(top.state.ball.y).toBe(top.state.radius)

    const bottom = step(
      baseState({ phase: 'play', serveTimer: 0, ball: { x: 320, y: 396, vx: 200, vy: 300 } }),
      1 / 240,
      idle,
    )
    expect(bottom.events).toContain('wall')
    expect(bottom.state.ball.vy).toBeLessThan(0)
    expect(bottom.state.ball.y).toBe(400 - bottom.state.radius)
  })

  it('returns the ball straight and faster on a center paddle hit', () => {
    const s = baseState({ phase: 'play', serveTimer: 0 })
    const rect = paddleRect(s, 0)
    const ball = { x: rect.x + rect.w + s.radius + 1, y: s.paddle1Y, vx: -300, vy: 0 }
    const r = step({ ...s, ball }, 1 / 60, idle)
    expect(r.events).toContain('paddle')
    expect(r.state.ball.vx).toBeGreaterThan(0)
    expect(r.state.ball.vy).toBeCloseTo(0)
    expect(r.state.speed).toBeCloseTo(r.state.baseSpeed * 1.04)
    expect(r.state.hits).toBe(1)
    expect(r.state.ball.x).toBeGreaterThan(rect.x + rect.w)
  })

  it('bends the rebound angle from the hit offset up to 65 degrees', () => {
    expect(angleForOffset(0)).toBe(0)
    expect((angleForOffset(0.5) * 180) / Math.PI).toBeCloseTo(32.5)
    expect(angleForOffset(-1)).toBeCloseTo(-MAX_BOUNCE_ANGLE)
    expect((angleForOffset(-4) * 180) / Math.PI).toBeCloseTo(-65)

    const s = baseState({ phase: 'play', serveTimer: 0 })
    const rect = paddleRect(s, 0)
    const ball = { x: rect.x + rect.w + s.radius + 1, y: rect.y + rect.h, vx: -300, vy: 0 }
    const r = step({ ...s, ball }, 1 / 60, idle)
    const deg = (Math.atan2(r.state.ball.vy, r.state.ball.vx) * 180) / Math.PI
    expect(deg).toBeCloseTo(65)
    expect(r.state.ball.vx).toBeGreaterThan(0)
    expect(r.state.ball.vy).toBeGreaterThan(0)
  })

  it('flips horizontal direction on every paddle hit', () => {
    const s = baseState({ phase: 'play', serveTimer: 0 })
    const rect = paddleRect(s, 1)
    const ball = { x: rect.x - s.radius - 1, y: s.paddle2Y, vx: 300, vy: 0 }
    const r = step({ ...s, ball }, 1 / 60, idle)
    expect(r.events).toContain('paddle')
    expect(r.state.ball.vx).toBeLessThan(0)
    expect(r.state.ball.vy).toBeCloseTo(0)
    expect(r.state.ball.x).toBeLessThan(rect.x)
  })

  it('raises ball speed 4% per hit and caps it at 1.6x base', () => {
    const base = tuneFor('normal').ballSpeed
    expect(nextSpeed(base, base)).toBeCloseTo(base * 1.04)
    expect(nextSpeed(base * 1.6, base)).toBeCloseTo(base * 1.6)
    let speed = base
    for (let i = 0; i < 40; i++) speed = nextSpeed(speed, base)
    expect(speed).toBeCloseTo(base * 1.6)
  })

  it('awards a point when the ball passes a side and re-serves toward the conceder', () => {
    const s = baseState({
      phase: 'play',
      serveTimer: 0,
      ball: { x: 650, y: 200, vx: 300, vy: 0 },
    })
    const r = step(s, 1 / 60, idle)
    expect(r.events).toContain('score')
    expect(r.events).not.toContain('win')
    expect(r.state.score1).toBe(1)
    expect(r.state.score2).toBe(0)
    expect(r.state.phase).toBe('serve')
    expect(r.state.serveTimer).toBe(SERVE_TIME)
    expect(r.state.serveDir).toBe(1)
    expect(r.state.ball).toEqual({ x: 320, y: 200, vx: 0, vy: 0 })
    expect(r.state.speed).toBe(r.state.baseSpeed)

    const left = step(
      baseState({
        phase: 'play',
        serveTimer: 0,
        ball: { x: -50, y: 200, vx: -300, vy: 0 },
      }),
      1 / 60,
      idle,
    )
    expect(left.events).toContain('score')
    expect(left.state.score2).toBe(1)
    expect(left.state.serveDir).toBe(-1)
  })

  it('serves instantly without a tick under reduced motion', () => {
    const s = baseState({
      phase: 'play',
      serveTimer: 0,
      ball: { x: 650, y: 200, vx: 300, vy: 0 },
    })
    const r = step(s, 1 / 60, { ...idle, reducedMotion: true, rng })
    expect(r.state.phase).toBe('play')
    expect(r.state.serveTimer).toBe(0)
    expect(r.state.ball.vx).toBeGreaterThan(0)
    expect(r.events).toEqual(['score'])
  })

  it('declares a winner at 11 points and stops simulating', () => {
    const s = baseState({
      phase: 'play',
      serveTimer: 0,
      score1: WIN_SCORE - 1,
      ball: { x: 650, y: 200, vx: 300, vy: 0 },
    })
    const r = step(s, 1 / 60, idle)
    expect(r.events).toContain('win')
    expect(r.events).toContain('score')
    expect(r.state.score1).toBe(WIN_SCORE)
    expect(r.state.phase).toBe('over')
    expect(r.state.winner).toBe('p1')

    const after = step(r.state, 1 / 60, { p1: { dir: 1 }, p2: { dir: -1 } })
    expect(after.state).toBe(r.state)
    expect(after.events).toHaveLength(0)
  })

  it('makes easy paddles taller and the ball slower than hard', () => {
    expect(tuneFor('easy').ballSpeed).toBeLessThan(tuneFor('normal').ballSpeed)
    expect(tuneFor('normal').ballSpeed).toBeLessThan(tuneFor('hard').ballSpeed)
    expect(tuneFor('easy').paddleH).toBeGreaterThan(tuneFor('hard').paddleH)
    const easy = createInitialState(640, 400, 'easy', rng)
    const hard = createInitialState(640, 400, 'hard', rng)
    expect(easy.paddleH).toBe(tuneFor('easy').paddleH)
    expect(hard.paddleH).toBe(tuneFor('hard').paddleH)
    expect(easy.baseSpeed).toBeLessThan(hard.baseSpeed)
  })

  it('plays a full match to 11 without leaving the field', () => {
    let s = createInitialState(640, 400, 'normal', rng)
    let sawPaddle = false
    let total = 0
    for (let i = 0; i < 5000 && s.phase !== 'over'; i++) {
      const r = step(s, 1 / 60, {
        p1: { dir: -1 },
        p2: { dir: -1 },
        rng,
      })
      s = r.state
      if (r.events.includes('paddle')) sawPaddle = true
      total = s.score1 + s.score2
      expect(s.ball.y).toBeGreaterThanOrEqual(s.radius - 1e-9)
      expect(s.ball.y).toBeLessThanOrEqual(s.height - s.radius + 1e-9)
      expect(s.paddle1Y).toBeGreaterThanOrEqual(s.paddleH / 2)
      expect(s.paddle1Y).toBeLessThanOrEqual(s.height - s.paddleH / 2)
      expect(s.paddle2Y).toBeGreaterThanOrEqual(s.paddleH / 2)
      expect(s.paddle2Y).toBeLessThanOrEqual(s.height - s.paddleH / 2)
    }
    expect(s.phase).toBe('over')
    expect(s.winner).toBe('p1')
    expect(s.score1).toBe(WIN_SCORE)
    expect(s.score2).toBe(0)
    expect(sawPaddle || total > 0).toBe(true)
  })

  it('emits only wall, paddle, score, tick and win events', () => {
    const allowed: StepEvent[] = ['wall', 'paddle', 'score', 'tick', 'win']
    let s = createInitialState(640, 400, 'normal', rng)
    for (let i = 0; i < 400 && s.phase !== 'over'; i++) {
      const r = step(s, 1 / 60, { p1: { dir: 0 }, p2: { dir: i % 2 === 0 ? 1 : -1 }, rng })
      for (const ev of r.events) expect(allowed).toContain(ev)
      s = r.state
    }
  })
})

describe('pong snapshots', () => {
  it('round-trips through JSON losslessly', () => {
    const s = baseState({
      phase: 'play',
      ball: { x: 123.45, y: 98.76, vx: -200.55, vy: 50.24 },
      paddle1Y: 77.78,
      paddle2Y: 300.31,
      score1: 4,
      score2: 7,
      serveDir: -1,
      speed: 350,
      hits: 12,
    })
    const snap = encodeSnap(s)
    const parsed = parseSnap(JSON.parse(JSON.stringify(snap)))
    expect(parsed).toEqual(snap)
  })

  it('rounds to one decimal on encode', () => {
    const snap = encodeSnap(baseState({ ball: { x: 10.49, y: 20.51, vx: 0, vy: 0 } }))
    expect(snap.x).toBe(10.5)
    expect(snap.y).toBe(20.5)
  })

  it('rejects malformed payloads', () => {
    expect(parseSnap(null)).toBeNull()
    expect(parseSnap('snap')).toBeNull()
    expect(parseSnap({})).toBeNull()
    expect(parseSnap({ ...encodeSnap(baseState()), x: 'NaN' })).toBeNull()
    expect(parseSnap({ ...encodeSnap(baseState()), ph: 'serve2' })).toBeNull()
    expect(parseSnap({ ...encodeSnap(baseState()), w: 'p3' })).toBeNull()
    expect(parseSnap({ ...encodeSnap(baseState()), sd: 2 })).toBeNull()
    expect(parseSnap({ ...encodeSnap(baseState()), s1: -1 })).toBeNull()
    expect(parseSnap({ ...encodeSnap(baseState()), s1: 1.5 })).toBeNull()
    expect(parseSnap({ ...encodeSnap(baseState()), x: Number.POSITIVE_INFINITY })).toBeNull()
    expect(parseSnap({ ...encodeSnap(baseState()), h: Number.NaN })).toBeNull()
  })

  it('applies a snapshot over an existing state', () => {
    const incoming = encodeSnap(
      baseState({
        phase: 'play',
        ball: { x: 100, y: 200, vx: 250, vy: -80 },
        paddle1Y: 50,
        paddle2Y: 350,
        score1: 3,
        score2: 5,
        serveDir: -1,
        speed: 380,
      }),
    )
    const applied = applySnap(baseState({ paddle1Y: 200, paddle2Y: 200 }), incoming)
    expect(applied.ball).toEqual({ x: 100, y: 200, vx: 250, vy: -80 })
    expect(applied.paddle1Y).toBe(50)
    expect(applied.paddle2Y).toBe(350)
    expect(applied.score1).toBe(3)
    expect(applied.score2).toBe(5)
    expect(applied.phase).toBe('play')
    expect(applied.serveDir).toBe(-1)
    expect(applied.speed).toBe(380)
    expect(applied.hits).toBe(0)
  })

  it('clamps paddle positions that arrive out of bounds', () => {
    const snap = encodeSnap(baseState({ paddle1Y: -500, paddle2Y: 5000, phase: 'play' }))
    const applied = applySnap(baseState(), snap)
    expect(applied.paddle1Y).toBe(applied.paddleH / 2)
    expect(applied.paddle2Y).toBe(applied.height - applied.paddleH / 2)
  })

  it('extrapolates the ball in play and pins it inside the field', () => {
    const flying = baseState({
      phase: 'play',
      ball: { x: 10, y: 50, vx: -500, vy: 0 },
    })
    const far = extrapolateBall(flying, 10)
    expect(far.x).toBe(flying.radius)
    expect(far.y).toBe(50)

    const near = extrapolateBall(
      baseState({ phase: 'play', ball: { x: 300, y: 100, vx: 400, vy: 300 } }),
      0.1,
    )
    expect(near.x).toBe(340)
    expect(near.y).toBe(130)
  })

  it('never moves the ball outside of play', () => {
    const serving = baseState({ phase: 'serve', ball: { x: 320, y: 200, vx: 0, vy: 0 } })
    expect(extrapolateBall(serving, 0.5)).toEqual({ x: 320, y: 200 })
    const over = baseState({ phase: 'over', winner: 'p1', ball: { x: 5, y: 5, vx: 9, vy: 9 } })
    expect(extrapolateBall(over, 0.5)).toEqual({ x: 5, y: 5 })
  })
})
