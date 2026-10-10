import { describe, expect, it } from 'vitest'
import { GAME_IDS, MAX_SCORES, isGameId, validateScore } from './scoreRules'

describe('scoreRules', () => {
  it('exposes exactly the six arcade game ids', () => {
    expect([...GAME_IDS]).toEqual(['snake', '2048', 'breakout', 'blocks', 'pong', 'ttt'])
    expect(isGameId('snake')).toBe(true)
    expect(isGameId('2048')).toBe(true)
    expect(isGameId('breakout')).toBe(true)
    expect(isGameId('blocks')).toBe(true)
    expect(isGameId('pong')).toBe(true)
    expect(isGameId('ttt')).toBe(true)
  })

  it('accepts zero and the exact cap for every game', () => {
    for (const gameId of GAME_IDS) {
      expect(validateScore(gameId, 0)).toEqual({ ok: true, gameId, score: 0 })
      expect(validateScore(gameId, MAX_SCORES[gameId])).toEqual({
        ok: true,
        gameId,
        score: MAX_SCORES[gameId],
      })
    }
  })

  it('rejects unknown, malformed and non-string game ids', () => {
    expect(validateScore('tetris', 10)).toEqual({ ok: false, error: 'unknown game id' })
    expect(validateScore('snake ', 10)).toEqual({ ok: false, error: 'unknown game id' })
    expect(validateScore('SNAKE', 10)).toEqual({ ok: false, error: 'unknown game id' })
    expect(validateScore('', 10)).toEqual({ ok: false, error: 'unknown game id' })
    expect(validateScore(undefined, 10)).toEqual({ ok: false, error: 'unknown game id' })
    expect(validateScore(null, 10)).toEqual({ ok: false, error: 'unknown game id' })
    expect(validateScore(7, 10)).toEqual({ ok: false, error: 'unknown game id' })
  })

  it('rejects floats and non-number scores', () => {
    for (const gameId of GAME_IDS) {
      expect(validateScore(gameId, 1.5).ok).toBe(false)
      expect(validateScore(gameId, Number.NaN).ok).toBe(false)
      expect(validateScore(gameId, Number.POSITIVE_INFINITY).ok).toBe(false)
      expect(validateScore(gameId, '100').ok).toBe(false)
      expect(validateScore(gameId, null).ok).toBe(false)
      expect(validateScore(gameId, undefined).ok).toBe(false)
      expect(validateScore(gameId, {}).ok).toBe(false)
    }
  })

  it('rejects negative scores', () => {
    expect(validateScore('snake', -1)).toEqual({
      ok: false,
      error: 'score must be zero or greater',
    })
    expect(validateScore('ttt', -0.5).ok).toBe(false)
    expect(validateScore('pong', -900).ok).toBe(false)
  })

  it('rejects scores above the per-game cap', () => {
    expect(validateScore('snake', 200001).ok).toBe(false)
    expect(validateScore('2048', 400001).ok).toBe(false)
    expect(validateScore('breakout', 200001).ok).toBe(false)
    expect(validateScore('blocks', 1000001).ok).toBe(false)
    expect(validateScore('pong', 12).ok).toBe(false)
    expect(validateScore('ttt', 901).ok).toBe(false)
  })

  it('documents the session-total caps for pong and ttt', () => {
    expect(MAX_SCORES.pong).toBe(11)
    expect(MAX_SCORES.ttt).toBe(900)
    expect(validateScore('pong', 11).ok).toBe(true)
    expect(validateScore('ttt', 900).ok).toBe(true)
  })
})
