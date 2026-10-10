import { describe, expect, it } from 'vitest'
import { flattenPresence, pickOpponent } from './presence'

describe('presence', () => {
  it('returns an empty list for junk state', () => {
    expect(flattenPresence(null)).toEqual([])
    expect(flattenPresence(undefined)).toEqual([])
    expect(flattenPresence({ me: 'nope' })).toEqual([])
  })

  it('flattens a realtime presence state', () => {
    const state = {
      abc: [
        { uid: 'u1', name: 'Ada', ready: true, started: false, presence_ref: '1' },
        { uid: 'u2', name: 'Grace', ready: false, started: true, presence_ref: '2' },
      ],
    }
    expect(flattenPresence(state)).toEqual([
      { uid: 'u1', name: 'Ada', ready: true, started: false },
      { uid: 'u2', name: 'Grace', ready: false, started: true },
    ])
  })

  it('drops entries without a uid and defaults missing names', () => {
    const state = {
      room: [{ name: 'Ghost', presence_ref: '1' }, { uid: 'u3', presence_ref: '3' }, 42],
    }
    expect(flattenPresence(state)).toEqual([
      { uid: 'u3', name: 'Player', ready: false, started: false },
    ])
  })

  it('dedupes the same uid across buckets', () => {
    const state = {
      a: [{ uid: 'u1', name: 'Ada' }],
      b: [{ uid: 'u1', name: 'Ada' }],
    }
    expect(flattenPresence(state)).toHaveLength(1)
  })

  it('only treats exact true as ready/started', () => {
    const state = { r: [{ uid: 'u1', ready: 'yes', started: 1 }] }
    expect(flattenPresence(state)[0]).toEqual({
      uid: 'u1',
      name: 'Player',
      ready: false,
      started: false,
    })
  })

  it('picks the first member who is not me', () => {
    const members = flattenPresence({
      r: [
        { uid: 'me', name: 'Me' },
        { uid: 'them', name: 'Them', ready: true },
      ],
    })
    expect(pickOpponent(members, 'me')?.uid).toBe('them')
    expect(pickOpponent(members, 'them')?.uid).toBe('me')
    expect(pickOpponent([], 'me')).toBeNull()
    expect(pickOpponent(members.slice(0, 1), 'me')).toBeNull()
  })
})
