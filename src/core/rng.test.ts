import { describe, expect, it } from 'vitest'
import { mulberry32, pick, randInt } from './rng'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    for (let i = 0; i < 100; i++) expect(a()).toBe(b())
  })

  it('produces different streams for different seeds', () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })

  it('stays in [0, 1)', () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('randInt respects bounds', () => {
    const rng = mulberry32(3)
    for (let i = 0; i < 500; i++) {
      const v = randInt(rng, 5, 9)
      expect(v).toBeGreaterThanOrEqual(5)
      expect(v).toBeLessThanOrEqual(9)
    }
  })

  it('pick selects from the list', () => {
    const rng = mulberry32(9)
    const items = ['a', 'b', 'c'] as const
    for (let i = 0; i < 100; i++) expect(items).toContain(pick(rng, items))
  })
})
