import { describe, expect, it } from 'vitest'
import { backoffDelay, backoffSchedule, BACKOFF_BASE_MS, BACKOFF_CAP_MS } from './backoff'

describe('backoff', () => {
  it('doubles from 1s up to the 30s cap', () => {
    expect(BACKOFF_BASE_MS).toBe(1000)
    expect(BACKOFF_CAP_MS).toBe(30000)
    expect(backoffDelay(0)).toBe(1000)
    expect(backoffDelay(1)).toBe(2000)
    expect(backoffDelay(2)).toBe(4000)
    expect(backoffDelay(3)).toBe(8000)
    expect(backoffDelay(4)).toBe(16000)
    expect(backoffDelay(5)).toBe(30000)
    expect(backoffDelay(12)).toBe(30000)
  })

  it('treats junk attempts as the first retry', () => {
    expect(backoffDelay(-3)).toBe(1000)
    expect(backoffDelay(Number.NaN)).toBe(1000)
    expect(backoffDelay(Number.POSITIVE_INFINITY)).toBe(30000)
    expect(backoffDelay(2.9)).toBe(4000)
  })

  it('honours custom base and cap', () => {
    expect(backoffDelay(1, 500, 2000)).toBe(1000)
    expect(backoffDelay(4, 500, 2000)).toBe(2000)
  })

  it('builds a growing, capped schedule', () => {
    expect(backoffSchedule(7)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000])
    expect(backoffSchedule(0)).toEqual([])
  })
})
