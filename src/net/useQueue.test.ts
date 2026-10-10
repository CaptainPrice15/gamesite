import { describe, expect, it } from 'vitest'
import { parseEnqueueResult } from './useQueue'

const MATCH_ID = '11111111-1111-1111-1111-111111111111'
const OPPONENT = '22222222-2222-2222-2222-222222222222'

describe('parseEnqueueResult', () => {
  it('reads a matched payload', () => {
    expect(
      parseEnqueueResult({
        matched: true,
        match_id: MATCH_ID,
        room_code: 'XK4M9P',
        opponent: OPPONENT,
      }),
    ).toEqual({ kind: 'matched', matchId: MATCH_ID, code: 'XK4M9P', opponent: OPPONENT })
  })

  it('tolerates a missing opponent id', () => {
    expect(parseEnqueueResult({ matched: true, match_id: MATCH_ID, room_code: 'XK4M9P' })).toEqual({
      kind: 'matched',
      matchId: MATCH_ID,
      code: 'XK4M9P',
      opponent: '',
    })
  })

  it('reads a waiting payload', () => {
    expect(parseEnqueueResult({ matched: false })).toEqual({ kind: 'waiting' })
  })

  it('reads a cooldown payload', () => {
    expect(parseEnqueueResult({ matched: false, cooldown_sec: 60 })).toEqual({
      kind: 'cooldown',
      seconds: 60,
    })
    expect(parseEnqueueResult({ matched: false, cooldown_sec: 1.4 })).toEqual({
      kind: 'cooldown',
      seconds: 2,
    })
  })

  it('rejects malformed payloads', () => {
    expect(parseEnqueueResult(null)).toEqual({ kind: 'invalid' })
    expect(parseEnqueueResult('nope')).toEqual({ kind: 'invalid' })
    expect(parseEnqueueResult({})).toEqual({ kind: 'invalid' })
    expect(parseEnqueueResult({ matched: true })).toEqual({ kind: 'invalid' })
    expect(parseEnqueueResult({ matched: true, match_id: MATCH_ID })).toEqual({
      kind: 'invalid',
    })
    expect(parseEnqueueResult({ matched: true, match_id: '', room_code: 'XK4M9P' })).toEqual({
      kind: 'invalid',
    })
    expect(parseEnqueueResult({ matched: false, cooldown_sec: 0 })).toEqual({ kind: 'waiting' })
    expect(parseEnqueueResult({ matched: 'yes' })).toEqual({ kind: 'invalid' })
  })
})
