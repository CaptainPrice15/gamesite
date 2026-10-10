import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import {
  BALL_RADIUS,
  COLS,
  MAX_BALLS,
  MIN_VY,
  ROWS,
  WIDE_DURATION,
  WIDE_SCALE,
  brickLayout,
  brickRect,
  createPlayState,
  damageBrick,
  generateBricks,
  movePaddle,
  setPaddle,
  step,
  wallBottom,
  type PlayState,
  type StepResult,
} from './logic'

function base(): PlayState {
  return createPlayState({ width: 440, height: 560, difficulty: 'normal', rng: mulberry32(7) })
}

function run(s: PlayState, dt = 1 / 60, seed = 1, serveDelay = 0.9): StepResult {
  return step(s, dt, { rng: mulberry32(seed), serveDelay })
}

function power(type: 'wide' | 'multi', x: number, y: number): PlayState['powerups'][number] {
  return { x, y, vy: 160, w: 30, h: 14, type }
}

describe('breakout layout', () => {
  it('creates a playable initial state', () => {
    const s = base()
    expect(s.lives).toBe(3)
    expect(s.level).toBe(1)
    expect(s.score).toBe(0)
    expect(s.over).toBe(false)
    expect(s.serveTimer).toBe(0)
    expect(s.balls).toHaveLength(1)
    expect(s.bricks).toHaveLength(COLS * ROWS)
    expect(s.paddleX).toBe(220)
    expect(s.paddleX - s.paddleW / 2).toBeGreaterThanOrEqual(0)
    expect(s.paddleX + s.paddleW / 2).toBeLessThanOrEqual(s.w)
    expect(s.paddleY + s.paddleH).toBeLessThan(s.h)
    expect(s.balls[0].vy).toBeGreaterThan(0)
    expect(s.balls[0].y).toBeGreaterThan(wallBottom(brickLayout(s.w, s.h)))
  })

  it('uses a single hit for bricks on level 1', () => {
    const s = base()
    expect(s.bricks.filter((b) => b.row === 0).every((b) => b.hp === 1)).toBe(true)
  })

  it('armours the top row from level 2 onward', () => {
    const s: PlayState = { ...base(), level: 2, bricks: generateBricks(2, mulberry32(9)) }
    const idx = s.bricks.findIndex((b) => b.row === 0)
    expect(idx).toBeGreaterThanOrEqual(0)
    expect(s.bricks[idx].hp).toBe(2)
    const first = damageBrick(s, idx, mulberry32(4))
    expect(first.bricks[idx].alive).toBe(true)
    expect(first.bricks[idx].hp).toBe(1)
    expect(first.score).toBe(0)
    const second = damageBrick(first, idx, mulberry32(4))
    expect(second.bricks[idx].alive).toBe(false)
    expect(second.score).toBe(20)
  })

  it('varies the brick pattern per level', () => {
    const masks = new Set(
      [1, 2, 3, 4, 5].map((lv) =>
        generateBricks(lv, mulberry32(3))
          .map((b) => `${b.col},${b.row}`)
          .join('|'),
      ),
    )
    expect(masks.size).toBe(5)
    expect(generateBricks(1, mulberry32(3))).toHaveLength(COLS * ROWS)
    const l2 = generateBricks(2, mulberry32(3))
    expect(l2.length).toBeGreaterThan(8)
    expect(l2.length).toBeLessThan(COLS * ROWS)
  })

  it('keeps bricks in the bottom row for every level', () => {
    for (let lv = 1; lv <= 10; lv++) {
      const bricks = generateBricks(lv, mulberry32(lv * 11))
      expect(bricks.length).toBeGreaterThan(8)
      expect(bricks.some((b) => b.row === ROWS - 1)).toBe(true)
      expect(bricks.every((b) => b.row >= 0 && b.row < ROWS)).toBe(true)
      expect(bricks.every((b) => b.col >= 0 && b.col < COLS)).toBe(true)
    }
  })

  it('is deterministic for a fixed seed', () => {
    expect(generateBricks(3, mulberry32(99))).toEqual(generateBricks(3, mulberry32(99)))
  })

  it('tunes paddle size and ball speed for difficulty', () => {
    const easy = createPlayState({
      width: 440,
      height: 560,
      difficulty: 'easy',
      rng: mulberry32(1),
    })
    const hard = createPlayState({
      width: 440,
      height: 560,
      difficulty: 'hard',
      rng: mulberry32(1),
    })
    expect(easy.paddleW).toBeGreaterThan(hard.paddleW)
    expect(easy.speed).toBeLessThan(hard.speed)
    expect(easy.paddleX - easy.paddleW / 2).toBeGreaterThanOrEqual(0)
    expect(hard.paddleX + hard.paddleW / 2).toBeLessThanOrEqual(hard.w)
  })
})

describe('breakout paddle', () => {
  it('clamps the paddle inside the field', () => {
    const s = base()
    const left = movePaddle(s, -10000)
    expect(left.paddleX).toBe(left.paddleW / 2)
    const right = setPaddle(s, 1e9)
    expect(right.paddleX).toBe(s.w - right.paddleW / 2)
    expect(setPaddle(s, s.paddleX)).toBe(s)
  })

  it('rebounds straight up from the paddle centre', () => {
    const s = base()
    const ball = { x: s.paddleX, y: s.paddleY - BALL_RADIUS + 1, vx: 0, vy: 240 }
    const res = run({ ...s, balls: [ball] })
    const b = res.state.balls[0]
    expect(res.sfx).toContain('bounce')
    expect(b.vy).toBeLessThan(0)
    expect(Math.abs(b.vx)).toBeLessThan(0.001)
    expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(240, 5)
  })

  it('rebounds at a steep angle from the paddle edge', () => {
    const s = base()
    const half = s.paddleW / 2
    const ball = { x: s.paddleX + half - 1, y: s.paddleY - BALL_RADIUS + 1, vx: 0, vy: 240 }
    const res = run({ ...s, balls: [ball] })
    const b = res.state.balls[0]
    const angle = (Math.atan2(Math.abs(b.vx), Math.abs(b.vy)) * 180) / Math.PI
    expect(b.vy).toBeLessThan(0)
    expect(angle).toBeGreaterThan(50)
    expect(angle).toBeLessThanOrEqual(60.001)
  })

  it('rejects a near-horizontal path after any bounce', () => {
    const s = base()
    const ball = { x: 220, y: 300, vx: 300, vy: -8 }
    const res = run({ ...s, balls: [ball] })
    const b = res.state.balls[0]
    const mag = Math.hypot(b.vx, b.vy)
    expect(Math.abs(b.vy) / mag).toBeGreaterThanOrEqual(MIN_VY - 1e-6)
    expect(mag).toBeCloseTo(Math.hypot(300, 8), 4)
  })
})

describe('breakout ball physics', () => {
  it('bounces off the side wall', () => {
    const s = base()
    const ball = { x: BALL_RADIUS + 1, y: 300, vx: -300, vy: -60 }
    const res = run({ ...s, balls: [ball] })
    const b = res.state.balls[0]
    expect(b.vx).toBeGreaterThan(0)
    expect(b.x).toBeGreaterThanOrEqual(BALL_RADIUS - 0.001)
    expect(res.sfx).toContain('wall')
  })

  it('bounces off the top wall', () => {
    const s = base()
    const ball = { x: 220, y: BALL_RADIUS + 1, vx: 100, vy: -300 }
    const res = run({ ...s, balls: [ball] })
    expect(res.state.balls[0].vy).toBeGreaterThan(0)
    expect(res.state.balls[0].y).toBeGreaterThanOrEqual(BALL_RADIUS - 0.001)
    expect(res.sfx).toContain('wall')
  })

  it('does not tunnel through bricks at high speed', () => {
    const s = base()
    const layout = brickLayout(s.w, s.h)
    const target = s.bricks.find((b) => b.row === 3 && b.col === 4)
    expect(target).toBeDefined()
    if (!target) return
    const rect = brickRect(layout, target.col, target.row)
    const ball = {
      x: rect.x + rect.w / 2,
      y: rect.y + rect.h + BALL_RADIUS + 2,
      vx: 0,
      vy: -3000,
    }
    const res = run({ ...s, balls: [ball], speed: 3000 })
    expect(res.state.bricks.some((b) => !b.alive)).toBe(true)
    expect(res.scoreChanged).toBe(true)
    expect(res.state.score).toBeGreaterThanOrEqual(10)
    expect(res.state.balls).toHaveLength(1)
  })

  it('scores 10 points per brick and speeds the ball up', () => {
    const s = base()
    const idx = s.bricks.findIndex((b) => b.alive && b.hp === 1)
    const next = damageBrick(s, idx, mulberry32(4))
    expect(next.score).toBe(10)
    expect(next.bricks[idx].alive).toBe(false)
    expect(next.speed).toBeGreaterThan(s.speed)
    expect(s.bricks[idx].alive).toBe(true)
    expect(s.score).toBe(0)
  })

  it('multiplies brick points by the level', () => {
    const s: PlayState = { ...base(), level: 3 }
    const idx = s.bricks.findIndex((b) => b.alive && b.hp === 1)
    expect(damageBrick(s, idx, mulberry32(4)).score).toBe(30)
  })

  it('caps the per-hit speed ramp', () => {
    let s = base()
    for (let i = 0; i < s.bricks.length; i++) s = damageBrick(s, i, mulberry32(5))
    expect(s.speed).toBeLessThanOrEqual(s.baseSpeed * 1.75 + 1e-9)
    expect(s.speed).toBeGreaterThan(s.baseSpeed)
  })

  it('drops power-ups from a share of destroyed bricks', () => {
    let s = base()
    let drops = 0
    const rng = mulberry32(2024)
    for (let i = 0; i < s.bricks.length; i++) {
      const before = s.powerups.length
      s = damageBrick(s, i, rng)
      drops += s.powerups.length - before
    }
    expect(s.bricks.some((b) => b.alive)).toBe(false)
    expect(s.score).toBe(400)
    expect(drops).toBeGreaterThan(0)
    expect(drops).toBeLessThan(40)
  })
})

describe('breakout lives and levels', () => {
  it('loses a life only once every ball is gone', () => {
    const s: PlayState = {
      ...base(),
      balls: [
        { x: 100, y: 600, vx: 0, vy: 300 },
        { x: 300, y: 300, vx: 0, vy: -300 },
      ],
    }
    const res = run(s)
    expect(res.lifeLost).toBe(false)
    expect(res.state.lives).toBe(3)
    expect(res.state.balls).toHaveLength(1)
    expect(res.state.over).toBe(false)
  })

  it('loses a life and serves again when every ball falls', () => {
    const s: PlayState = {
      ...base(),
      balls: [
        { x: 100, y: 600, vx: 0, vy: 300 },
        { x: 300, y: 620, vx: 0, vy: 300 },
      ],
    }
    const res = run(s, 1 / 60, 1, 0.9)
    expect(res.lifeLost).toBe(true)
    expect(res.gameOver).toBe(false)
    expect(res.sfx).toContain('die')
    expect(res.state.lives).toBe(2)
    expect(res.state.balls).toHaveLength(1)
    expect(res.state.serveTimer).toBeGreaterThan(0)
    expect(res.state.balls[0].y).toBeCloseTo(res.state.paddleY - BALL_RADIUS - 3, 5)
  })

  it('serves immediately when there is no delay', () => {
    const s: PlayState = { ...base(), lives: 2, balls: [{ x: 100, y: 620, vx: 0, vy: 300 }] }
    const res = run(s, 1 / 60, 3, 0)
    expect(res.lifeLost).toBe(true)
    expect(res.sfx).toContain('die')
    expect(res.sfx).toContain('start')
    expect(res.state.serveTimer).toBe(0)
    expect(res.state.balls).toHaveLength(1)
    expect(res.state.balls[0].vy).toBeLessThan(0)
  })

  it('launches the ball once the serve delay expires', () => {
    const s: PlayState = { ...base(), lives: 2, serveTimer: 0.3 }
    const first = run(s, 1 / 60, 3, 0.3)
    expect(first.sfx).not.toContain('start')
    expect(first.state.serveTimer).toBeCloseTo(0.3 - 1 / 60, 6)
    expect(first.state.balls[0].y).toBeCloseTo(s.paddleY - BALL_RADIUS - 3, 5)
    const second = run(first.state, 1, 3, 0.3)
    expect(second.sfx).toContain('start')
    expect(second.state.serveTimer).toBe(0)
    expect(second.state.balls[0].vy).toBeLessThan(0)
  })

  it('ends the game when the last life is spent', () => {
    const s: PlayState = { ...base(), lives: 1, balls: [{ x: 100, y: 620, vx: 0, vy: 300 }] }
    const res = run(s)
    expect(res.lifeLost).toBe(true)
    expect(res.gameOver).toBe(true)
    expect(res.sfx).toContain('die')
    expect(res.state.over).toBe(true)
    expect(res.state.lives).toBe(0)
    expect(res.state.balls).toHaveLength(0)
    const again = run(res.state)
    expect(again.gameOver).toBe(false)
    expect(again.state).toBe(res.state)
  })

  it('clears the level, keeps the score and rebuilds the wall', () => {
    const s = base()
    const cleared: PlayState = {
      ...s,
      bricks: s.bricks.map((b) => ({ ...b, alive: false, hp: 0 })),
    }
    const res = run(cleared, 1 / 60, 2, 0.9)
    expect(res.levelCleared).toBe(true)
    expect(res.sfx).toContain('clear')
    expect(res.state.level).toBe(2)
    expect(res.state.score).toBe(50)
    expect(res.state.bricks.some((b) => b.alive)).toBe(true)
    expect(res.state.bricks.some((b) => b.hp === 2)).toBe(true)
    expect(res.state.serveTimer).toBeGreaterThan(0)
    expect(res.state.speed).toBeCloseTo(s.baseSpeed * 1.05, 6)
  })
})

describe('breakout power-ups', () => {
  it('widens the paddle and expires after the duration', () => {
    const s = base()
    const pickup: PlayState = {
      ...s,
      serveTimer: 1e9,
      powerups: [power('wide', s.paddleX, s.paddleY - 3)],
    }
    const first = run(pickup, 1 / 60, 6, 0.9)
    expect(first.sfx).toContain('click')
    expect(first.state.powerups).toHaveLength(0)
    expect(first.state.paddleW).toBeCloseTo(first.state.basePaddleW * WIDE_SCALE, 5)
    expect(first.state.wideTimer).toBe(WIDE_DURATION)
    let cur = first.state
    for (let i = 0; i < 10; i++) cur = run(cur, 1, 6, 0.9).state
    expect(cur.wideTimer).toBe(0)
    expect(cur.paddleW).toBe(cur.basePaddleW)
    expect(cur.paddleX + cur.paddleW / 2).toBeLessThanOrEqual(cur.w)
  })

  it('spawns an extra ball for the multi power-up', () => {
    const s = base()
    const pickup: PlayState = {
      ...s,
      serveTimer: 1e9,
      powerups: [power('multi', s.paddleX, s.paddleY - 3)],
    }
    const res = run(pickup, 1 / 60, 6, 0.9)
    expect(res.sfx).toContain('click')
    expect(res.state.balls).toHaveLength(2)
    const full: PlayState = {
      ...s,
      serveTimer: 1e9,
      balls: s.balls.concat([s.balls[0], s.balls[0], s.balls[0]]),
      powerups: [power('multi', s.paddleX, s.paddleY - 3)],
    }
    expect(run(full, 1 / 60, 6, 0.9).state.balls).toHaveLength(MAX_BALLS)
  })

  it('removes power-ups that fall past the field', () => {
    const s = base()
    const falling: PlayState = {
      ...s,
      serveTimer: 1e9,
      powerups: [{ ...power('wide', 20, s.h + 40), y: s.h + 40 }],
    }
    expect(run(falling, 1 / 60, 6, 0.9).state.powerups).toHaveLength(0)
  })
})

describe('breakout attract frame', () => {
  it('keeps the wall intact and the ball in flight after 30 frames', () => {
    let s = base()
    for (let i = 0; i < 30; i++) s = run(s, 1 / 60, 11, 0.9).state
    expect(s.bricks.filter((b) => b.alive)).toHaveLength(COLS * ROWS)
    expect(s.lives).toBe(3)
    expect(s.balls).toHaveLength(1)
    const b = s.balls[0]
    expect(b.y).toBeGreaterThan(wallBottom(brickLayout(s.w, s.h)))
    expect(b.y).toBeLessThan(s.paddleY)
    expect(b.x).toBeGreaterThan(0)
    expect(b.x).toBeLessThan(s.w)
    expect(s.powerups).toHaveLength(0)
  })
})
