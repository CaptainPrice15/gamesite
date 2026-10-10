import { describe, expect, it } from 'vitest'
import { DEFAULT_ELO, K_FACTOR, clampRating, eloDelta, expectedScore, formatDelta } from './elo'

describe('expectedScore', () => {
  it('gives 50% to equal ratings', () => {
    expect(expectedScore(DEFAULT_ELO, DEFAULT_ELO)).toBeCloseTo(0.5, 10)
  })

  it('splits to 100% between the two players', () => {
    const a = expectedScore(1400, 1200)
    const b = expectedScore(1200, 1400)
    expect(a + b).toBeCloseTo(1, 10)
    expect(a).toBeGreaterThan(0.5)
  })

  it('uses the classic 400-point scale', () => {
    expect(expectedScore(1600, 1200)).toBeCloseTo(1 / (1 + 10 ** -1), 10)
    expect(expectedScore(1200, 1600)).toBeCloseTo(1 / (1 + 10 ** 1), 10)
  })
})

describe('eloDelta', () => {
  it('awards +16 for a win between equals', () => {
    expect(eloDelta(1200, 1200, 1)).toBe(16)
  })

  it('awards 0 for a draw between equals', () => {
    expect(eloDelta(1200, 1200, 0.5)).toBe(0)
  })

  it('gives a bigger reward for beating a stronger opponent', () => {
    const upset = eloDelta(1200, 1400, 1)
    const expected = eloDelta(1200, 1200, 1)
    expect(upset).toBeGreaterThan(expected)
    expect(upset).toBe(24)
  })

  it('loses rating when losing to a weaker opponent', () => {
    expect(eloDelta(1400, 1200, 0)).toBe(-24)
  })

  it('rounds half away from zero like postgres round()', () => {
    expect(eloDelta(1200, 1200, 1, 33)).toBe(17)
    expect(eloDelta(1200, 1200, 0, 33)).toBe(-17)
  })

  it('respects a custom K', () => {
    expect(eloDelta(1200, 1200, 1, 16)).toBe(8)
    expect(K_FACTOR).toBe(32)
  })
})

describe('clampRating', () => {
  it('keeps ratings inside 0..4000', () => {
    expect(clampRating(-5)).toBe(0)
    expect(clampRating(1200)).toBe(1200)
    expect(clampRating(9999)).toBe(4000)
  })
})

describe('formatDelta', () => {
  it('prefixes positive deltas with a plus', () => {
    expect(formatDelta(8)).toBe('+8')
    expect(formatDelta(-8)).toBe('-8')
    expect(formatDelta(0)).toBe('0')
  })
})
