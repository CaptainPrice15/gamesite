import { describe, expect, it } from 'vitest'
import { isUuid, matchOutcome, reportsAgree, resolveWinnerUuid } from './match'

const ME = '11111111-1111-1111-1111-111111111111'
const OPP = '22222222-2222-2222-2222-222222222222'

describe('resolveWinnerUuid', () => {
  it('maps pong winner codes onto uuids for both roles', () => {
    expect(resolveWinnerUuid('p1', 'p1', ME, OPP)).toBe(ME)
    expect(resolveWinnerUuid('p1', 'p2', ME, OPP)).toBe(OPP)
    expect(resolveWinnerUuid('p2', 'p1', ME, OPP)).toBe(OPP)
    expect(resolveWinnerUuid('p2', 'p2', ME, OPP)).toBe(ME)
  })

  it('maps ttt side numbers onto uuids', () => {
    expect(resolveWinnerUuid(1, 'p1', ME, OPP)).toBe(ME)
    expect(resolveWinnerUuid(2, 'p1', ME, OPP)).toBe(OPP)
    expect(resolveWinnerUuid(2, 'p2', ME, OPP)).toBe(ME)
  })

  it('treats draws and unknown codes as no winner', () => {
    expect(resolveWinnerUuid(null, 'p1', ME, OPP)).toBeNull()
    expect(resolveWinnerUuid(undefined, 'p1', ME, OPP)).toBeNull()
    expect(resolveWinnerUuid('X', 'p1', ME, OPP)).toBeNull()
    expect(resolveWinnerUuid(3, 'p1', ME, OPP)).toBeNull()
  })

  it('returns null when ids are unknown rather than guessing', () => {
    expect(resolveWinnerUuid('p1', 'p1', '', OPP)).toBeNull()
    expect(resolveWinnerUuid('p1', 'p1', ME, '')).toBeNull()
  })
})

describe('reportsAgree', () => {
  it('accepts identical winners', () => {
    expect(reportsAgree({ winner: ME, isVoid: false }, { winner: ME, isVoid: false })).toBe(true)
    expect(reportsAgree({ winner: null, isVoid: false }, { winner: null, isVoid: false })).toBe(
      true,
    )
  })

  it('rejects different winners', () => {
    expect(reportsAgree({ winner: ME, isVoid: false }, { winner: OPP, isVoid: false })).toBe(false)
    expect(reportsAgree({ winner: ME, isVoid: false }, { winner: null, isVoid: false })).toBe(false)
  })

  it('rejects a void flag mismatch', () => {
    expect(reportsAgree({ winner: ME, isVoid: false }, { winner: ME, isVoid: true })).toBe(false)
    expect(reportsAgree({ winner: null, isVoid: true }, { winner: null, isVoid: true })).toBe(true)
  })
})

describe('isUuid', () => {
  it('accepts canonical uuids only', () => {
    expect(isUuid(ME)).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid('')).toBe(false)
    expect(isUuid(7)).toBe(false)
    expect(isUuid(null)).toBe(false)
  })
})

describe('matchOutcome', () => {
  it('classifies finished matches', () => {
    expect(matchOutcome('finished', ME, ME, OPP)).toBe('win')
    expect(matchOutcome('finished', OPP, ME, OPP)).toBe('loss')
    expect(matchOutcome('finished', null, ME, OPP)).toBe('draw')
    expect(matchOutcome('void', ME, ME, OPP)).toBe('void')
    expect(matchOutcome('active', ME, ME, OPP)).toBe('unfinished')
    expect(matchOutcome('pending', null, ME, OPP)).toBe('unfinished')
  })

  it('treats an unknown winner as unfinished', () => {
    expect(matchOutcome('finished', 'someone-else', ME, OPP)).toBe('unfinished')
  })
})
