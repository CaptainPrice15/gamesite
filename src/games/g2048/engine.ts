import type { Game, GameCreateArgs, HudValue } from '../../core/types'
import {
  applyMove,
  bestTile,
  canMove,
  createBoard,
  fourChanceFor,
  SIZE,
  spawnTile,
  type Dir,
  type TileMove,
} from './logic'

const SLIDE = 0.11
const POP = 0.16
const DIRS: Dir[] = ['up', 'down', 'left', 'right']
const FAMILY = "'Segoe UI', system-ui, sans-serif"

const TILE_BG: Record<number, string> = {
  2: '#e9eef7',
  4: '#dde7f5',
  8: '#fbbf24',
  16: '#fb923c',
  32: '#f87171',
  64: '#ef4444',
  128: '#f472b6',
  256: '#c084fc',
  512: '#818cf8',
  1024: '#38bdf8',
  2048: '#4ade80',
}

const TILE_FG: Record<number, string> = {
  2: '#333344',
  4: '#333344',
  8: '#3b2a06',
  16: '#431c04',
  32: '#4c0f0f',
  64: '#4c0d0d',
  128: '#4a0d2e',
  256: '#2e1065',
  512: '#1e1b4b',
  1024: '#082f49',
  2048: '#052e16',
}

interface Anim {
  moves: TileMove[]
  t: number
  dur: number
}

interface Pop {
  index: number
  t: number
}

export function create({
  width,
  height,
  input,
  audio,
  rng,
  settings,
  events,
}: GameCreateArgs): Game {
  const reduced = settings.reducedMotion
  const fourChance = fourChanceFor(settings.difficulty)
  const pad = Math.max(6, Math.min(width, height) * 0.03)
  const size = Math.min(width, height) - pad * 2
  const ox = (width - size) / 2
  const oy = (height - size) / 2
  const unit = size / SIZE
  const gap = Math.max(2, unit * 0.07)
  const radius = Math.max(3, unit * 0.12)
  const inner = unit - gap

  let board = createBoard(rng, fourChance)
  let score = 0
  let won = false
  let over = false
  let anim: Anim | null = null
  let buffer: Dir | null = null
  let pops: Pop[] = []

  const centerOf = (index: number): { x: number; y: number } => ({
    x: ox + ((index % SIZE) + 0.5) * unit,
    y: oy + (Math.floor(index / SIZE) + 0.5) * unit,
  })

  const emitHud = (): void => {
    const hud: HudValue[] = [
      { label: 'Score', value: score },
      { label: 'Best tile', value: bestTile(board) },
    ]
    if (won) hud.push({ label: 'Reached 2048', value: 'Yes' })
    events.onHud(hud)
  }

  const finishTurn = (): void => {
    if (!won && board.some((value) => value >= 2048)) {
      won = true
      audio.play('win')
    }
    const spawned = spawnTile(board, rng, fourChance)
    if (spawned) {
      board = spawned.board
      if (!reduced) pops.push({ index: spawned.index, t: 0 })
    }
    emitHud()
    if (!over && !canMove(board)) {
      over = true
      audio.play('die')
      events.onGameOver({ score })
    }
  }

  const tryMove = (dir: Dir): void => {
    const result = applyMove(board, dir)
    if (!result.changed) return
    board = result.board
    if (result.score > 0) {
      score += result.score
      events.onScore(score)
    }
    audio.play('move')
    if (result.merges > 0) {
      const peak = Math.max(...result.mergedValues)
      const index = Math.round(Math.log2(peak))
      audio.play('merge', { pitch: 1 + Math.min(index, 8) * 0.05 })
    }
    emitHud()
    if (reduced) {
      finishTurn()
    } else {
      anim = { moves: result.moves, t: 0, dur: SLIDE }
    }
  }

  const pollDir = (): Dir | null => {
    for (const dir of DIRS) {
      if (input.pressed(0, dir)) return dir
    }
    return null
  }

  events.onHud([
    { label: 'Score', value: 0 },
    { label: 'Best tile', value: bestTile(board) },
  ])
  events.onScore(0)

  return {
    update(dt: number): void {
      for (const pop of pops) pop.t += dt
      pops = pops.filter((pop) => pop.t < POP)

      const pressed = pollDir()
      if (pressed) buffer = pressed

      if (anim) {
        anim.t += dt
        if (anim.t < anim.dur) return
        anim = null
        finishTurn()
      }

      if (over || buffer === null) return
      const dir = buffer
      buffer = null
      tryMove(dir)
    },

    render(ctx: CanvasRenderingContext2D): void {
      ctx.fillStyle = '#0d1420'
      ctx.fillRect(0, 0, width, height)

      ctx.fillStyle = '#101a2a'
      roundRect(ctx, ox, oy, size, size, radius * 1.6)
      ctx.fill()

      ctx.fillStyle = 'rgba(255,255,255,0.05)'
      for (let i = 0; i < board.length; i++) {
        const c = centerOf(i)
        roundRect(ctx, c.x - inner / 2, c.y - inner / 2, inner, inner, radius)
        ctx.fill()
      }

      if (anim) {
        const p = Math.min(1, anim.t / anim.dur)
        const eased = 1 - Math.pow(1 - p, 3)
        for (const move of anim.moves) {
          const from = centerOf(move.from)
          const to = centerOf(move.to)
          drawTile(
            ctx,
            from.x + (to.x - from.x) * eased,
            from.y + (to.y - from.y) * eased,
            move.value,
            1,
            inner,
            radius,
          )
        }
      } else {
        for (let i = 0; i < board.length; i++) {
          const value = board[i]
          if (value === 0) continue
          const pop = pops.find((entry) => entry.index === i)
          const scale = pop ? 1 - Math.pow(1 - Math.min(1, pop.t / POP), 2) : 1
          const c = centerOf(i)
          drawTile(ctx, c.x, c.y, value, scale, inner, radius)
        }
      }

      if (over) {
        ctx.fillStyle = 'rgba(13,20,32,0.72)'
        ctx.fillRect(0, 0, width, height)
        const fs = Math.max(16, size * 0.1)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = '#e9eef7'
        ctx.font = `bold ${fs}px ${FAMILY}`
        ctx.fillText('Game Over', width / 2, height / 2 - fs * 0.6)
        ctx.font = `600 ${fs * 0.5}px ${FAMILY}`
        ctx.fillStyle = 'rgba(233,238,247,0.75)'
        ctx.fillText(`Score ${score}`, width / 2, height / 2 + fs * 0.55)
      }
    },

    destroy(): void {
      anim = null
      buffer = null
      pops = []
    },
  }
}

function drawTile(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  value: number,
  scale: number,
  inner: number,
  radius: number,
): void {
  if (scale <= 0.01) return
  const s = inner * scale
  const bg = TILE_BG[value] ?? '#facc15'
  const fg = TILE_FG[value] ?? '#3f2c03'
  ctx.fillStyle = bg
  roundRect(ctx, cx - s / 2, cy - s / 2, s, s, radius * Math.min(1, scale))
  ctx.fill()

  const text = String(value)
  const digits = text.length
  const ratio = digits <= 2 ? 0.44 : digits === 3 ? 0.35 : 0.27
  let fs = s * ratio
  ctx.fillStyle = fg
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `bold ${fs}px ${FAMILY}`
  const measured = ctx.measureText(text).width
  const max = s * 0.82
  if (measured > max && measured > 0) {
    fs = Math.max(6, (fs * max) / measured)
    ctx.font = `bold ${fs}px ${FAMILY}`
  }
  ctx.fillText(text, cx, cy)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
}
