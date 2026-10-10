import type { Game, GameCreateArgs } from '../../core/types'
import {
  PADDLE_SPEED,
  SERVE_TIME,
  applySnap,
  clamp,
  clampPaddle,
  createInitialState,
  encodeSnap,
  extrapolateBall,
  paddleRect,
  parseSnap,
  step,
  type PongSnap,
  type Rect,
  type StepEvent,
  type StepInput,
} from './logic'

const FIXED_DT = 1 / 60
const SNAP_DT = 1 / 12
const SEND_DT = 0.04
const P1_COLOR = '#a78bfa'
const P2_COLOR = '#f472b6'
const BALL_COLOR = '#f8fafc'
const BG_COLOR = '#0d1420'

export function create({
  width,
  height,
  canvas,
  input,
  audio,
  rng,
  settings,
  events,
  online,
}: GameCreateArgs): Game {
  input.bindKeys?.(0, { up: ['KeyW'], down: ['KeyS'], action: ['Space'], pause: ['Escape'] })
  input.bindKeys?.(1, { up: ['ArrowUp'], down: ['ArrowDown'] })

  const onlineMode = online !== undefined
  const isHost = online?.role === 'p1'
  const myWinner = online?.role ?? null

  let state = createInitialState(width, height, settings.difficulty, rng, settings.reducedMotion)
  let overSent = false
  let lastHud = ''
  const pointers = new Map<number, { side: 0 | 1; y: number }>()
  const prevTouchAction = canvas.style.touchAction
  canvas.style.touchAction = 'none'

  let remoteInput: StepInput = { dir: 0 }
  let pendingEvents: StepEvent[] = []
  let snapAcc = 0
  let clock = 0
  let snapClock = 0
  let lastSnap: PongSnap | null = null
  let lastSent: { d: number; t: number | null } | null = null
  let lastSendClock = -1
  let unsubscribe: (() => void) | null = null
  let oppTargetY = height / 2

  const fieldPoint = (e: PointerEvent): { side: 0 | 1; y: number } => {
    const rect = canvas.getBoundingClientRect()
    const sx = rect.width === 0 ? 1 : width / rect.width
    const sy = rect.height === 0 ? 1 : height / rect.height
    const x = (e.clientX - rect.left) * sx
    const y = (e.clientY - rect.top) * sy
    return { side: x < width / 2 ? 0 : 1, y: clamp(y, 0, height) }
  }

  const localSideAllowed = (side: 0 | 1): boolean => {
    if (!onlineMode) return true
    return isHost ? side === 0 : side === 1
  }

  const onPointerDown = (e: PointerEvent): void => {
    const point = fieldPoint(e)
    if (!localSideAllowed(point.side)) return
    pointers.set(e.pointerId, point)
    canvas.setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: PointerEvent): void => {
    if (!pointers.has(e.pointerId)) return
    pointers.set(e.pointerId, fieldPoint(e))
  }

  const onPointerEnd = (e: PointerEvent): void => {
    pointers.delete(e.pointerId)
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId)
  }

  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerup', onPointerEnd)
  canvas.addEventListener('pointercancel', onPointerEnd)

  const readInput = (side: 0 | 1): StepInput => {
    let target: number | undefined
    for (const p of pointers.values()) if (p.side === side) target = p.y
    if (target !== undefined) return { dir: 0, target }
    const up = input.down(side, 'up') ? -1 : 0
    const down = input.down(side, 'down') ? 1 : 0
    return { dir: up + down }
  }

  const sendGameOver = (): void => {
    if (overSent || !state.winner) return
    overSent = true
    const winner = state.winner
    events.onGameOver({
      score: winner === 'p1' ? state.score1 : state.score2,
      win: onlineMode && myWinner !== null ? winner === myWinner : undefined,
      meta: { winner },
    })
  }

  const onEvent = (ev: StepEvent): void => {
    if (isHost) pendingEvents.push(ev)
    switch (ev) {
      case 'wall':
        audio.play('wall')
        break
      case 'paddle':
        audio.play('bounce')
        break
      case 'score':
        audio.play('die')
        break
      case 'tick':
        audio.play('countdown')
        break
      case 'win':
        audio.play('win')
        sendGameOver()
        break
    }
  }

  const emitHud = (): void => {
    const key = `${state.score1}-${state.score2}`
    if (key === lastHud) return
    lastHud = key
    events.onScore(state.score1 + state.score2)
    events.onHud([
      { label: 'P1', value: state.score1 },
      { label: 'P2', value: state.score2 },
    ])
  }

  const simulate = (dt: number): void => {
    const result = step(state, dt, {
      p1: readInput(0),
      p2: onlineMode && isHost ? remoteInput : readInput(1),
      reducedMotion: settings.reducedMotion,
      rng,
    })
    state = result.state
    for (const ev of result.events) onEvent(ev)
    emitHud()
  }

  const applyRemoteSnap = (raw: unknown): void => {
    if (typeof raw !== 'object' || raw === null) return
    const payload = raw as { s?: unknown; e?: unknown }
    const snap = parseSnap(payload.s)
    if (!snap) return
    lastSnap = snap
    snapClock = clock
    const myY = state.paddle2Y
    state = applySnap(state, snap)
    state.paddle2Y = myY
    oppTargetY = snap.p1
    emitHud()
    if (Array.isArray(payload.e)) {
      for (const ev of payload.e) {
        if (ev === 'wall' || ev === 'paddle' || ev === 'score' || ev === 'tick' || ev === 'win') {
          onEvent(ev)
        }
      }
    }
    if (state.phase === 'over') sendGameOver()
  }

  const stepGuest = (dt: number): void => {
    const mine = readInput(1)
    const nextY =
      mine.target !== undefined
        ? clampPaddle(mine.target, state.paddleH, state.height)
        : clampPaddle(
            state.paddle2Y + clamp(mine.dir, -1, 1) * PADDLE_SPEED * dt,
            state.paddleH,
            state.height,
          )
    state = { ...state, paddle2Y: nextY }

    const d = clamp(mine.dir, -1, 1)
    const t = mine.target ?? null
    if (!lastSent || lastSent.d !== d || lastSent.t !== t) {
      if (clock - lastSendClock >= SEND_DT) {
        online?.hooks.emit('input', { d, t })
        lastSent = { d, t }
        lastSendClock = clock
      }
    }

    if (lastSnap) {
      state = {
        ...state,
        ball: { x: lastSnap.x, y: lastSnap.y, vx: lastSnap.vx, vy: lastSnap.vy },
      }
      const extrapolated = extrapolateBall(state, clock - snapClock)
      const k = 1 - Math.exp(-14 * dt)
      state = {
        ...state,
        ball: { x: extrapolated.x, y: extrapolated.y, vx: lastSnap.vx, vy: lastSnap.vy },
        serveTimer: state.phase === 'serve' ? Math.max(0, state.serveTimer - dt) : state.serveTimer,
        paddle1Y: state.paddle1Y + (oppTargetY - state.paddle1Y) * k,
      }
    }
  }

  if (online) {
    unsubscribe = online.hooks.subscribe((msg) => {
      if (isHost) {
        if (msg.type !== 'input') return
        const data = msg.data as { d?: unknown; t?: unknown } | null
        if (typeof data?.d !== 'number' || !Number.isFinite(data.d)) return
        const dir = clamp(data.d, -1, 1)
        const target =
          typeof data.t === 'number' && Number.isFinite(data.t)
            ? clamp(data.t, 0, height)
            : undefined
        remoteInput = { dir, target }
        return
      }
      if (msg.type === 'snap') applyRemoteSnap(msg.data)
    })
  }

  emitHud()

  return {
    update(dt: number): void {
      const frame = Math.min(Math.max(dt, 0), 0.1)
      clock += frame
      if (onlineMode && !isHost) {
        stepGuest(frame)
        return
      }
      simulate(FIXED_DT)
      if (onlineMode && isHost) {
        snapAcc += frame
        if (snapAcc >= SNAP_DT) {
          snapAcc = 0
          const sent = pendingEvents
          pendingEvents = []
          online?.hooks.emit('snap', { s: encodeSnap(state), e: sent })
        }
      }
    },

    render(ctx: CanvasRenderingContext2D): void {
      ctx.fillStyle = BG_COLOR
      ctx.fillRect(0, 0, width, height)

      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.font = `800 ${Math.round(height * 0.5)}px system-ui, sans-serif`
      ctx.fillStyle = 'rgba(255,255,255,0.07)'
      ctx.fillText(String(state.score1), width * 0.3, height * 0.5)
      ctx.fillText(String(state.score2), width * 0.7, height * 0.5)

      ctx.strokeStyle = 'rgba(255,255,255,0.15)'
      ctx.lineWidth = Math.max(2, Math.round(height * 0.008))
      ctx.setLineDash([Math.max(4, height * 0.035), Math.max(6, height * 0.05)])
      ctx.beginPath()
      ctx.moveTo(width / 2, 0)
      ctx.lineTo(width / 2, height)
      ctx.stroke()
      ctx.setLineDash([])

      drawPaddle(ctx, paddleRect(state, 0), P1_COLOR)
      drawPaddle(ctx, paddleRect(state, 1), P2_COLOR)

      if (state.phase === 'serve') {
        const t = clamp(state.serveTimer / SERVE_TIME, 0, 1)
        ctx.strokeStyle = 'rgba(248,250,252,0.4)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(width / 2, height / 2, state.radius + 6 + t * 24, 0, Math.PI * 2)
        ctx.stroke()
      }

      ctx.fillStyle = BALL_COLOR
      ctx.beginPath()
      ctx.arc(state.ball.x, state.ball.y, state.radius, 0, Math.PI * 2)
      ctx.fill()

      if (state.phase === 'over') {
        ctx.fillStyle = 'rgba(13,20,32,0.72)'
        ctx.fillRect(0, 0, width, height)
        const winner = state.winner
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.font = `800 ${Math.round(height * 0.16)}px system-ui, sans-serif`
        ctx.fillStyle = winner === 'p2' ? P2_COLOR : P1_COLOR
        ctx.fillText(winner === 'p2' ? 'P2 WINS' : 'P1 WINS', width / 2, height * 0.42)
        ctx.font = `700 ${Math.round(height * 0.09)}px system-ui, sans-serif`
        ctx.fillStyle = 'rgba(248,250,252,0.85)'
        ctx.fillText(`${state.score1} - ${state.score2}`, width / 2, height * 0.58)
      }
    },

    destroy(): void {
      unsubscribe?.()
      unsubscribe = null
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerEnd)
      canvas.removeEventListener('pointercancel', onPointerEnd)
      canvas.style.touchAction = prevTouchAction
      pointers.clear()
    },
  }
}

function drawPaddle(ctx: CanvasRenderingContext2D, rect: Rect, color: string): void {
  ctx.fillStyle = color
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, rect.w / 2)
  ctx.fill()
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
