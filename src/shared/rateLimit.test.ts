import { describe, expect, it } from 'vitest'
import { clientKey, rateLimit } from './rateLimit'

describe('rateLimit', () => {
  it('allows requests under the limit', () => {
    const t0 = 1_000_000
    for (let i = 0; i < 5; i++) {
      expect(rateLimit('a', 5, t0 + i).ok).toBe(true)
    }
  })

  it('blocks the request that exceeds the limit and reports a wait', () => {
    const t0 = 2_000_000
    for (let i = 0; i < 3; i++) rateLimit('b', 3, t0 + i)
    const blocked = rateLimit('b', 3, t0 + 10)
    expect(blocked.ok).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
    expect(blocked.retryAfterSec).toBeLessThanOrEqual(60)
  })

  it('resets after the window passes', () => {
    const t0 = 3_000_000
    rateLimit('c', 1, t0)
    expect(rateLimit('c', 1, t0 + 1_000).ok).toBe(false)
    expect(rateLimit('c', 1, t0 + 61_000).ok).toBe(true)
  })

  it('keeps keys independent', () => {
    const t0 = 4_000_000
    rateLimit('d1', 1, t0)
    expect(rateLimit('d2', 1, t0).ok).toBe(true)
    expect(rateLimit('d1', 1, t0).ok).toBe(false)
  })
})

describe('clientKey', () => {
  it('reads the first x-forwarded-for hop', () => {
    expect(clientKey({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })).toBe('1.2.3.4')
    expect(clientKey({ headers: { 'x-forwarded-for': ['9.9.9.9'] } })).toBe('9.9.9.9')
  })

  it('falls back to x-real-ip then unknown', () => {
    expect(clientKey({ headers: { 'x-real-ip': ' 7.7.7.7 ' } })).toBe('7.7.7.7')
    expect(clientKey({ headers: {} })).toBe('unknown')
    expect(clientKey({ headers: { 'x-forwarded-for': '  ' } })).toBe('unknown')
  })
})
