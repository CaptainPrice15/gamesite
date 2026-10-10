import { describe, expect, it } from 'vitest'
import { isNewerRow, parseTttRow, type TttRow } from './useTttNet'

const P1 = '11111111-1111-1111-1111-111111111111'
const P2 = '22222222-2222-2222-2222-222222222222'

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'game-1',
    updated_at: '2026-01-01T00:00:00.000Z',
    board: [0, 0, 0, 0, 0, 0, 0, 0, 0],
    p1: P1,
    p2: P2,
    turn: P1,
    winner: '',
    status: 'active',
    ...overrides,
  }
}

describe('parseTttRow', () => {
  it('maps a live row onto client state', () => {
    const parsed = parseTttRow(
      row({
        board: [1, 2, 0, 0, 1, 0, 0, 0, 2],
        turn: P2,
        winner: P1,
        status: 'finished',
      }),
    )
    expect(parsed).toEqual({
      id: 'game-1',
      updated_at: '2026-01-01T00:00:00.000Z',
      board: [1, 2, 0, 0, 1, 0, 0, 0, 2],
      turn: 2,
      winner: 1,
      finished: true,
    })
  })

  it('maps empty turn and winner to null', () => {
    const parsed = parseTttRow(row({ turn: '', winner: '' }))
    expect(parsed?.turn).toBeNull()
    expect(parsed?.winner).toBeNull()
    expect(parsed?.finished).toBe(false)
  })

  it('returns null for rows that fail validation', () => {
    expect(parseTttRow(null)).toBeNull()
    expect(parseTttRow('x')).toBeNull()
    expect(parseTttRow(row({ id: '' }))).toBeNull()
    expect(parseTttRow(row({ updated_at: '' }))).toBeNull()
    expect(parseTttRow(row({ board: [0, 0, 0] }))).toBeNull()
    expect(parseTttRow(row({ board: [0, 0, 0, 0, 0, 0, 0, 0, 7] }))).toBeNull()
    expect(parseTttRow(row({ status: 'paused' }))).toBeNull()
    expect(parseTttRow(row({ turn: 'someone-else', p1: P1, p2: P2 }))).toBeNull()
  })
})

describe('isNewerRow', () => {
  const base: TttRow = {
    id: 'game-1',
    updated_at: '2026-01-01T00:00:00.000Z',
    board: Array(9).fill(0),
    turn: 1,
    winner: null,
    finished: false,
  }

  it('accepts the first row and strictly newer timestamps', () => {
    expect(isNewerRow(base, null)).toBe(true)
    expect(isNewerRow({ ...base, updated_at: '2026-01-01T00:00:01.000Z' }, base)).toBe(true)
    expect(isNewerRow({ ...base, updated_at: '2026-01-01T00:00:00.000Z' }, base)).toBe(false)
    expect(isNewerRow({ ...base, updated_at: '2025-12-31T23:59:59.000Z' }, base)).toBe(false)
  })

  it('treats a different game id as fresh state', () => {
    expect(isNewerRow({ ...base, id: 'game-2' }, base)).toBe(true)
  })

  it('falls back to string comparison for unparseable timestamps', () => {
    const weird = { ...base, updated_at: 'not-a-date' }
    expect(isNewerRow(weird, base)).toBe(true)
    expect(isNewerRow({ ...base, updated_at: 'also-bad' }, weird)).toBe(true)
    expect(
      isNewerRow({ ...base, updated_at: 'not-a-date' }, { ...base, updated_at: 'not-a-date' }),
    ).toBe(false)
  })
})
