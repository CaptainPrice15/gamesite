import { describe, expect, it } from 'vitest'
import { load, loadBest, save, saveBest } from './storage'

describe('storage', () => {
  it('round-trips values', () => {
    save('unit-test', { a: 1, b: 'two' })
    expect(load('unit-test', null)).toEqual({ a: 1, b: 'two' })
  })

  it('returns the fallback for missing or broken values', () => {
    expect(load('missing-key', 42)).toBe(42)
    localStorage.setItem('arcade.broken', '{not json')
    expect(load('broken', 'fallback')).toBe('fallback')
  })

  it('tracks high scores', () => {
    expect(loadBest('unit-game')).toBe(0)
    expect(saveBest('unit-game', 100)).toEqual({ best: 100, isRecord: true })
    expect(saveBest('unit-game', 50)).toEqual({ best: 100, isRecord: false })
    expect(saveBest('unit-game', 250)).toEqual({ best: 250, isRecord: true })
  })
})
