import { describe, expect, it } from 'vitest'
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from './roomCode'

describe('roomCode', () => {
  it('generates a 6-char crockford code', () => {
    const code = generateRoomCode()
    expect(code).toHaveLength(6)
    expect(isValidRoomCode(code)).toBe(true)
  })

  it('never contains excluded characters I L O U 0 1', () => {
    for (let i = 0; i < 500; i++) {
      expect(generateRoomCode()).not.toMatch(/[ILOU01]/)
    }
  })

  it('is deterministic with a fixed rng', () => {
    let i = 0
    const rng = () => (i++ % 10) / 10
    expect(generateRoomCode(rng)).toBe('258BEH')
  })

  it('validates and normalizes codes', () => {
    expect(isValidRoomCode('XK4M9P')).toBe(true)
    expect(isValidRoomCode('ILOU01'.slice(0, 6))).toBe(false)
    expect(isValidRoomCode('ABC')).toBe(false)
    expect(normalizeRoomCode('  xk4m9p ')).toBe('XK4M9P')
  })
})
