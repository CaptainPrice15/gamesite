import { describe, expect, it } from 'vitest'
import { mulberry32 } from '../../core/rng'
import { applyMove, bestTile, canMove, CELLS, createBoard, fourChanceFor, spawnTile } from './logic'

const rng = () => mulberry32(1234)

function board(firstRow: number[]): number[] {
  const rest = new Array<number>(CELLS - firstRow.length).fill(0)
  return [...firstRow, ...rest]
}

describe('2048 logic', () => {
  it('creates a board with exactly two starter tiles', () => {
    const b = createBoard(rng(), 0.1)
    expect(b).toHaveLength(CELLS)
    const filled = b.filter((v) => v !== 0)
    expect(filled).toHaveLength(2)
    for (const value of filled) expect([2, 4]).toContain(value)
  })

  it('slides tiles to the wall without merging', () => {
    const result = applyMove(board([0, 2, 0, 4]), 'left')
    expect(result.board.slice(0, 4)).toEqual([2, 4, 0, 0])
    expect(result.changed).toBe(true)
    expect(result.score).toBe(0)
    expect(result.merges).toBe(0)
  })

  it('merges a pair and scores the merged value', () => {
    const result = applyMove(board([2, 2, 0, 0]), 'left')
    expect(result.board.slice(0, 4)).toEqual([4, 0, 0, 0])
    expect(result.score).toBe(4)
    expect(result.merges).toBe(1)
    expect(result.mergedValues).toEqual([4])
  })

  it('merges each pair once per move', () => {
    const result = applyMove(board([2, 2, 2, 2]), 'left')
    expect(result.board.slice(0, 4)).toEqual([4, 4, 0, 0])
    expect(result.score).toBe(8)
    expect(result.merges).toBe(2)
  })

  it('does not merge a tile produced by another merge', () => {
    const result = applyMove(board([4, 4, 8, 0]), 'left')
    expect(result.board.slice(0, 4)).toEqual([8, 8, 0, 0])
    expect(result.score).toBe(8)
    expect(result.merges).toBe(1)
  })

  it('ranks merges behind existing tiles', () => {
    const result = applyMove(board([2, 2, 4, 4]), 'left')
    expect(result.board.slice(0, 4)).toEqual([4, 8, 0, 0])
    expect(result.score).toBe(12)
  })

  it('moves toward the right wall', () => {
    const result = applyMove(board([2, 2, 0, 0]), 'right')
    expect(result.board.slice(0, 4)).toEqual([0, 0, 0, 4])
    expect(result.score).toBe(4)
  })

  it('moves toward the top wall', () => {
    const cells = new Array<number>(CELLS).fill(0)
    cells[0] = 2
    cells[12] = 2
    const result = applyMove(cells, 'up')
    expect(result.board[0]).toBe(4)
    expect(result.board[12]).toBe(0)
    expect(result.score).toBe(4)
  })

  it('moves toward the bottom wall', () => {
    const cells = new Array<number>(CELLS).fill(0)
    cells[0] = 8
    cells[4] = 8
    const result = applyMove(cells, 'down')
    expect(result.board[12]).toBe(16)
    expect(result.board[0]).toBe(0)
    expect(result.score).toBe(16)
  })

  it('reports no change when nothing can slide', () => {
    const cells = [2, 4, 8, 16, 4, 8, 16, 2, 8, 16, 2, 4, 16, 2, 4, 8]
    for (const dir of ['left', 'right', 'up', 'down'] as const) {
      const result = applyMove(cells, dir)
      expect(result.changed).toBe(false)
      expect(result.board).toEqual(cells)
      expect(result.moves.every((m) => m.from === m.to)).toBe(true)
    }
  })

  it('never mutates the input board', () => {
    const cells = board([2, 2, 0, 0])
    applyMove(cells, 'left')
    expect(cells).toEqual(board([2, 2, 0, 0]))
  })

  it('tracks source and destination for every moving tile', () => {
    const result = applyMove(board([2, 0, 0, 2]), 'left')
    expect(result.moves).toEqual([
      { from: 0, to: 0, value: 2 },
      { from: 3, to: 0, value: 2 },
    ])
  })

  it('spawns into a uniformly empty cell', () => {
    const cells = new Array<number>(CELLS).fill(0)
    cells[5] = 2
    const spawned = spawnTile(cells, rng(), 0)
    expect(spawned).not.toBeNull()
    if (!spawned) return
    expect(spawned.index).toBeGreaterThanOrEqual(0)
    expect(spawned.index).toBeLessThan(CELLS)
    expect(spawned.board[5]).toBe(2)
    expect(spawned.board[spawned.index]).toBe(2)
    expect(spawned.board.filter((v) => v !== 0)).toHaveLength(2)
  })

  it('spawns a four when the difficulty chance allows it', () => {
    const cells = new Array<number>(CELLS).fill(0)
    const forced = spawnTile(cells, rng(), 1)
    expect(forced?.value).toBe(4)
    const modest = spawnTile(cells, rng(), 0)
    expect(modest?.value).toBe(2)
  })

  it('refuses to spawn on a full board', () => {
    const full = [2, 4, 8, 16, 4, 8, 16, 2, 8, 16, 2, 4, 16, 2, 4, 8]
    expect(spawnTile(full, rng(), 0.1)).toBeNull()
  })

  it('detects game over only when no legal move exists', () => {
    expect(canMove([2, 4, 8, 16, 4, 8, 16, 2, 8, 16, 2, 4, 16, 2, 4, 8])).toBe(false)
    expect(canMove([2, 2, 8, 16, 4, 8, 16, 2, 8, 16, 2, 4, 16, 2, 4, 8])).toBe(true)
    expect(canMove([2, 4, 8, 16, 4, 8, 16, 2, 8, 16, 2, 4, 16, 2, 4, 0])).toBe(true)
  })

  it('scales the four spawn chance by difficulty', () => {
    expect(fourChanceFor('easy')).toBe(0.05)
    expect(fourChanceFor('normal')).toBe(0.1)
    expect(fourChanceFor('hard')).toBe(0.15)
  })

  it('reports the highest tile on the board', () => {
    expect(bestTile([2, 4, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(1024)
    expect(bestTile(new Array<number>(CELLS).fill(0))).toBe(0)
  })
})
