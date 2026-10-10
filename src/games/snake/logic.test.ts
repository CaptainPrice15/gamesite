import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import { createInitialState, queueDirection, speedFor, step, type SnakeState } from './logic'

const rng = () => mulberry32(1234)

function baseState(): SnakeState {
  return {
    snake: [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 3, y: 5 },
    ],
    dir: 'right',
    queuedDir: null,
    food: { x: 8, y: 5 },
    score: 0,
    eaten: 0,
    alive: true,
  }
}

describe('snake logic', () => {
  it('creates an initial state with a 3-segment snake and reachable food', () => {
    const s = createInitialState(rng())
    expect(s.snake).toHaveLength(3)
    expect(s.alive).toBe(true)
    expect(s.food.x).toBeGreaterThanOrEqual(0)
    expect(s.snake.some((c) => c.x === s.food.x && c.y === s.food.y)).toBe(false)
  })

  it('moves the head and keeps the tail when not eating', () => {
    const s = step(baseState(), rng(), { wrap: false })
    expect(s.snake[0]).toEqual({ x: 6, y: 5 })
    expect(s.snake).toHaveLength(3)
    expect(s.score).toBe(0)
  })

  it('grows and scores when eating', () => {
    const s = step({ ...baseState(), food: { x: 6, y: 5 } }, rng(), { wrap: false })
    expect(s.snake).toHaveLength(4)
    expect(s.score).toBe(10)
    expect(s.eaten).toBe(1)
    expect(s.food).not.toEqual({ x: 6, y: 5 })
  })

  it('dies on the wall when wrap is off', () => {
    const s: SnakeState = {
      ...baseState(),
      snake: [
        { x: 19, y: 0 },
        { x: 18, y: 0 },
        { x: 17, y: 0 },
      ],
      food: { x: 0, y: 0 },
    }
    expect(step(s, rng(), { wrap: false }).alive).toBe(false)
  })

  it('wraps around the wall when wrap is on', () => {
    const s: SnakeState = {
      ...baseState(),
      snake: [
        { x: 19, y: 0 },
        { x: 18, y: 0 },
        { x: 17, y: 0 },
      ],
      food: { x: 0, y: 0 },
    }
    const next = step(s, rng(), { wrap: true })
    expect(next.alive).toBe(true)
    expect(next.snake[0]).toEqual({ x: 0, y: 0 })
    expect(next.score).toBe(10)
  })

  it('dies when biting itself', () => {
    const s: SnakeState = {
      ...baseState(),
      snake: [
        { x: 5, y: 5 },
        { x: 5, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 5 },
        { x: 4, y: 6 },
        { x: 5, y: 6 },
        { x: 6, y: 6 },
      ],
      queuedDir: 'up',
      food: { x: 1, y: 1 },
    }
    const next = step(s, rng(), { wrap: false })
    expect(next.alive).toBe(false)
  })

  it('ignores a direct reversal', () => {
    const s = baseState()
    const reversed = queueDirection(s, 'left')
    expect(reversed.queuedDir).toBeNull()
    const turned = queueDirection(s, 'up')
    expect(turned.queuedDir).toBe('up')
  })

  it('caps the ramp of difficulty speed', () => {
    expect(speedFor(0, 'normal')).toBe(7.5)
    expect(speedFor(1000, 'hard')).toBeGreaterThan(speedFor(0, 'hard'))
    expect(speedFor(100000, 'normal')).toBeLessThanOrEqual(7.5 + 8)
    expect(speedFor(0, 'easy')).toBeLessThan(speedFor(0, 'hard'))
  })
})
