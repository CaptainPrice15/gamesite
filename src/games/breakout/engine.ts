import type { Game, GameCreateArgs } from '../../core/types'
import {
  BALL_RADIUS,
  brickLayout,
  brickRect,
  createPlayState,
  movePaddle,
  paddleSpeed,
  setPaddle,
  step,
} from './logic'

const FIXED = 1 / 60
const SERVE_DELAY = 0.9

export function create({
  width,
  height,
  canvas,
  input,
  audio,
  rng,
  settings,
  events,
}: GameCreateArgs): Game {
  const serveDelay = settings.reducedMotion ? 0 : SERVE_DELAY
  const difficulty = settings.difficulty
  let state = createPlayState({ width, height, difficulty, rng })
  let acc = 0
  let over = false
  let dragX: number | null = null
  let lastScore = -1
  let lastLives = -1
  let lastLevel = -1
  const prevTouchAction = canvas.style.touchAction
  canvas.style.touchAction = 'none'
  const win: Window | null = typeof window === 'undefined' ? null : window

  const emitHud = (): void => {
    if (state.score === lastScore && state.lives === lastLives && state.level === lastLevel) return
    lastScore = state.score
    lastLives = state.lives
    lastLevel = state.level
    events.onScore(state.score)
    events.onHud([
      { label: 'Score', value: state.score },
      { label: 'Lives', value: state.lives },
      { label: 'Level', value: state.level },
    ])
  }

  lastScore = state.score
  lastLives = state.lives
  lastLevel = state.level
  events.onHud([
    { label: 'Score', value: state.score },
    { label: 'Lives', value: state.lives },
    { label: 'Level', value: state.level },
  ])
  events.onScore(state.score)
  audio.play('start')

  const localX = (e: PointerEvent): number => {
    const rect = canvas.getBoundingClientRect()
    const scale = rect.width > 0 ? width / rect.width : 1
    return (e.clientX - rect.left) * scale
  }

  const onPointerDown = (e: PointerEvent): void => {
    dragX = localX(e)
    state = setPaddle(state, dragX)
    audio.resume()
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (dragX === null) return
    dragX = localX(e)
    state = setPaddle(state, dragX)
  }

  const onPointerUp = (): void => {
    dragX = null
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  win?.addEventListener('pointerup', onPointerUp)
  win?.addEventListener('pointercancel', onPointerUp)

  return {
    update(dt: number): void {
      if (over) return
      const frame = Math.min(dt, FIXED * 4)
      const dir = (input.down(0, 'right') ? 1 : 0) - (input.down(0, 'left') ? 1 : 0)
      if (dir !== 0) state = movePaddle(state, dir * paddleSpeed(width) * frame)
      acc = Math.min(acc + dt, FIXED * 4)
      while (acc >= FIXED) {
        acc -= FIXED
        const res = step(state, FIXED, { rng, serveDelay })
        state = res.state
        for (const name of res.sfx) audio.play(name)
        if (res.gameOver && !over) {
          over = true
          events.onScore(state.score)
          events.onGameOver({ score: state.score })
        }
        emitHud()
      }
    },

    render(ctx: CanvasRenderingContext2D): void {
      ctx.fillStyle = '#0d1420'
      ctx.fillRect(0, 0, width, height)

      ctx.fillStyle = 'rgba(248, 113, 113, 0.22)'
      ctx.fillRect(0, height - 3, width, 3)

      const layout = brickLayout(width, height)
      for (const brick of state.bricks) {
        if (!brick.alive) continue
        const r = brickRect(layout, brick.col, brick.row)
        ctx.fillStyle = brick.color
        roundRect(ctx, r.x, r.y, r.w, r.h, 4)
        ctx.fill()
        if (brick.hp < brick.maxHp) {
          ctx.fillStyle = 'rgba(13, 20, 32, 0.55)'
          roundRect(ctx, r.x, r.y, r.w, r.h, 4)
          ctx.fill()
        }
        ctx.fillStyle = 'rgba(255, 255, 255, 0.26)'
        roundRect(ctx, r.x + 2, r.y + 2, r.w - 4, 2, 1)
        ctx.fill()
      }

      for (const p of state.powerups) {
        ctx.fillStyle = p.type === 'wide' ? '#facc15' : '#38bdf8'
        roundRect(ctx, p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, p.h / 2)
        ctx.fill()
        ctx.fillStyle = '#0d1420'
        ctx.font = `bold ${Math.round(p.h * 0.75)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText(p.type === 'wide' ? 'W' : 'M', p.x, p.y + 1)
      }

      const px = state.paddleX - state.paddleW / 2
      ctx.fillStyle = '#38bdf8'
      roundRect(ctx, px, state.paddleY, state.paddleW, state.paddleH, state.paddleH / 2)
      ctx.fill()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.32)'
      roundRect(
        ctx,
        px + state.paddleW * 0.12,
        state.paddleY + 2,
        state.paddleW * 0.76,
        Math.max(2, state.paddleH * 0.22),
        2,
      )
      ctx.fill()

      for (const b of state.balls) {
        ctx.fillStyle = 'rgba(248, 250, 252, 0.16)'
        ctx.beginPath()
        ctx.arc(b.x, b.y, BALL_RADIUS + 3, 0, Math.PI * 2)
        ctx.fill()
        ctx.fillStyle = '#f8fafc'
        ctx.beginPath()
        ctx.arc(b.x, b.y, BALL_RADIUS, 0, Math.PI * 2)
        ctx.fill()
      }

      if (state.serveTimer > 0) {
        ctx.fillStyle = 'rgba(248, 250, 252, 0.5)'
        ctx.font = `bold ${Math.max(12, Math.round(height * 0.03))}px sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillText('GET READY', width / 2, state.paddleY - BALL_RADIUS * 6)
      }
    },

    destroy(): void {
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      win?.removeEventListener('pointerup', onPointerUp)
      win?.removeEventListener('pointercancel', onPointerUp)
      canvas.style.touchAction = prevTouchAction
      dragX = null
      over = true
      acc = 0
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
