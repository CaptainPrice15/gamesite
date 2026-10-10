import type { Game, GameCreateArgs } from '../../core/types'
import { COLS, ROWS, createInitialState, queueDirection, speedFor, step, type Dir } from './logic'

export function create({
  width,
  height,
  input,
  audio,
  rng,
  settings,
  events,
}: GameCreateArgs): Game {
  let state = createInitialState(rng)
  let acc = 0
  let dead = false
  let deadTimer = 0
  const cell = Math.min(width / COLS, height / ROWS)
  const boardW = cell * COLS
  const boardH = cell * ROWS
  const offX = (width - boardW) / 2
  const offY = (height - boardH) / 2
  const reduced = settings.reducedMotion
  let pulse = 0
  let lastHudScore = -1

  const speed = (): number => speedFor(state.score, settings.difficulty)

  const queueFromInput = (): void => {
    const dirs: Dir[] = ['up', 'down', 'left', 'right']
    for (const d of dirs) {
      if (input.pressed(0, d)) state = queueDirection(state, d)
    }
  }

  const emitHud = (): void => {
    if (state.score === lastHudScore) return
    lastHudScore = state.score
    events.onScore(state.score)
    events.onHud([
      { label: 'Score', value: state.score },
      { label: 'Length', value: state.snake.length },
    ])
  }

  events.onHud([
    { label: 'Score', value: 0 },
    { label: 'Length', value: state.snake.length },
  ])
  events.onScore(0)

  return {
    update(dt: number): void {
      queueFromInput()

      if (dead) {
        deadTimer += dt
        return
      }

      acc += dt
      const interval = 1 / speed()
      let steps = 0
      while (acc >= interval && steps < 4 && !dead) {
        acc -= interval
        steps++
        const prevFood = state.food
        state = step(state, rng, { wrap: settings.wrapWalls })
        if (!state.alive) {
          dead = true
          deadTimer = 0
          audio.play('die')
          events.onScore(state.score)
          events.onGameOver({ score: state.score, meta: { eaten: state.eaten } })
        } else if (state.food !== prevFood) {
          audio.play('eat')
          emitHud()
        }
      }
      if (steps === 0 && acc > interval) acc = interval

      pulse += dt
      emitHud()
    },

    render(ctx: CanvasRenderingContext2D): void {
      ctx.fillStyle = '#0d1420'
      ctx.fillRect(0, 0, width, height)

      ctx.fillStyle = '#101a2a'
      ctx.fillRect(offX, offY, boardW, boardH)

      ctx.strokeStyle = 'rgba(255,255,255,0.045)'
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 1; x < COLS; x++) {
        ctx.moveTo(offX + x * cell, offY)
        ctx.lineTo(offX + x * cell, offY + boardH)
      }
      for (let y = 1; y < ROWS; y++) {
        ctx.moveTo(offX, offY + y * cell)
        ctx.lineTo(offX + boardW, offY + y * cell)
      }
      ctx.stroke()

      ctx.strokeStyle = settings.wrapWalls ? 'rgba(56,189,248,0.35)' : 'rgba(248,113,113,0.35)'
      ctx.lineWidth = 2
      ctx.strokeRect(offX + 1, offY + 1, boardW - 2, boardH - 2)

      const scale = reduced ? 1 : 1 + Math.sin(pulse * 6) * 0.08
      const fx = offX + (state.food.x + 0.5) * cell
      const fy = offY + (state.food.y + 0.5) * cell
      ctx.fillStyle = '#fb7185'
      ctx.beginPath()
      ctx.arc(fx, fy, cell * 0.32 * scale, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255,255,255,0.35)'
      ctx.beginPath()
      ctx.arc(fx - cell * 0.08, fy - cell * 0.08, cell * 0.09, 0, Math.PI * 2)
      ctx.fill()

      const len = state.snake.length
      for (let i = len - 1; i >= 0; i--) {
        const seg = state.snake[i]
        const t = len === 1 ? 1 : 1 - i / len
        const x = offX + seg.x * cell
        const y = offY + seg.y * cell
        const pad = cell * 0.08
        ctx.fillStyle = i === 0 ? '#4ade80' : `rgba(74, 222, 128, ${0.45 + t * 0.5})`
        roundRect(ctx, x + pad, y + pad, cell - pad * 2, cell - pad * 2, cell * 0.25)
        ctx.fill()
      }

      const head = state.snake[0]
      if (head) {
        const hx = offX + (head.x + 0.5) * cell
        const hy = offY + (head.y + 0.5) * cell
        const d = state.dir
        const ex = d === 'left' ? -cell * 0.16 : d === 'right' ? cell * 0.16 : 0
        const ey = d === 'up' ? -cell * 0.16 : d === 'down' ? cell * 0.16 : 0
        ctx.fillStyle = '#052e16'
        ctx.beginPath()
        ctx.arc(hx + ex - cell * 0.12, hy + ey, cell * 0.07, 0, Math.PI * 2)
        ctx.arc(hx + ex + cell * 0.12, hy + ey, cell * 0.07, 0, Math.PI * 2)
        ctx.fill()
      }

      if (dead) {
        ctx.fillStyle = `rgba(11,15,23,${Math.min(0.55, deadTimer)})`
        ctx.fillRect(0, 0, width, height)
      }
    },

    destroy(): void {
      state = createInitialState(rng)
    },
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
