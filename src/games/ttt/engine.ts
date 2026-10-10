import type { Game, GameCreateArgs } from '../../core/types'
import {
  CELL_COUNT,
  DEMO_BOARD,
  SIZE,
  createRound,
  reduceRound,
  sessionScore,
  winnerOf,
  type Board,
  type Mark,
  type RoundState,
} from './logic'

const MARK_DUR = 0.14
const WIN_DUR = 0.45
const ROUND_DELAY = 1.2
const ROUND_DELAY_REDUCED = 0.3
const BG = '#0d1420'
const CELL_BG = '#101a2a'
const GAP = 'rgba(255,255,255,0.05)'
const WIN_COLOR = '#4ade80'
const TEXT_COLOR = 'rgba(226,232,240,0.85)'
const MARK_COLOR: Record<Mark, string> = { X: '#38bdf8', O: '#f472b6' }

interface ServerState {
  board: number[]
  turn: number | null
  winner: number | null
  finished: boolean
}

export function toServerState(raw: unknown): ServerState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (!Array.isArray(r.board) || r.board.length !== CELL_COUNT) return null
  const board: number[] = []
  for (const cell of r.board) {
    if (cell !== 0 && cell !== 1 && cell !== 2) return null
    board.push(cell)
  }
  return {
    board,
    turn: typeof r.turn === 'number' ? r.turn : null,
    winner: typeof r.winner === 'number' ? r.winner : null,
    finished: r.finished === true,
  }
}

export function roundFromServer(state: ServerState): RoundState {
  const board: Board = state.board.map((cell) => (cell === 1 ? 'X' : cell === 2 ? 'O' : null))
  const win = winnerOf(board)
  const status = win ? 'win' : state.finished ? 'draw' : 'playing'
  const tally = win
    ? { x: win.mark === 'X' ? 1 : 0, o: win.mark === 'O' ? 1 : 0, draws: 0 }
    : status === 'draw'
      ? { x: 0, o: 0, draws: 1 }
      : { x: 0, o: 0, draws: 0 }
  return {
    board,
    turn: state.turn === 2 ? 'O' : 'X',
    round: 1,
    starter: 'X',
    status,
    winner: win ? win.mark : null,
    winLine: win ? win.line : null,
    tally,
  }
}

export function create({
  width,
  height,
  canvas,
  input,
  audio,
  settings,
  events,
  online,
}: GameCreateArgs): Game {
  const pad = Math.max(12, Math.min(width, height) * 0.05)
  const bar = Math.max(22, Math.min(width, height) * 0.06)
  const boardSize = Math.max(72, Math.min(width - pad * 2, height - bar - pad))
  const cell = boardSize / SIZE
  const boardX = (width - boardSize) / 2
  const boardY = bar + Math.max(0, (height - bar - pad - boardSize) / 2)
  const gap = Math.max(2, cell * 0.05)
  const fontPx = Math.max(12, Math.round(bar * 0.62))

  const onlineMode = online !== undefined
  const mySide: 1 | 2 | null = online ? (online.role === 'p1' ? 1 : 2) : null
  const myMark: Mark = mySide === 2 ? 'O' : 'X'
  const initial = online ? toServerState(online.initial) : null

  let round: RoundState = initial
    ? roundFromServer(initial)
    : createRound({ round: 1, board: DEMO_BOARD })
  let cursor = 4
  let clock = 0
  let roundTimer = 0
  let winT = 0
  let hudKey = ''
  let overSent = false
  let unsubscribe: (() => void) | null = null
  const placedAt: number[] = Array.from({ length: CELL_COUNT }, () => -MARK_DUR)

  const centerOf = (index: number): { x: number; y: number } => ({
    x: boardX + ((index % SIZE) + 0.5) * cell,
    y: boardY + (Math.floor(index / SIZE) + 0.5) * cell,
  })

  const emitHud = (): void => {
    const key = `${round.tally.x}:${round.tally.o}:${round.tally.draws}`
    if (key === hudKey) return
    hudKey = key
    events.onScore(sessionScore(round.tally))
    events.onHud([
      { label: 'X', value: round.tally.x },
      { label: 'O', value: round.tally.o },
      { label: 'Draws', value: round.tally.draws },
    ])
  }

  const sendGameOver = (): void => {
    if (overSent) return
    overSent = true
    const winnerSide = round.winner === 'X' ? 1 : round.winner === 'O' ? 2 : null
    events.onGameOver({
      score: sessionScore(round.tally),
      ...(onlineMode ? { win: winnerSide !== null && winnerSide === mySide } : {}),
      meta: { winner: winnerSide },
    })
  }

  const applyServer = (state: ServerState): void => {
    const next = roundFromServer(state)
    const sameBoard = next.board.every((mark, index) => mark === round.board[index])
    if (sameBoard && next.status === round.status) return
    for (let index = 0; index < CELL_COUNT; index++) {
      if (!round.board[index] && next.board[index]) placedAt[index] = clock
    }
    const finishedBefore = round.status !== 'playing'
    round = next
    winT = 0
    roundTimer = 0
    if (round.status === 'playing') {
      audio.play('move')
    } else if (!finishedBefore) {
      winT = settings.reducedMotion ? 1 : 0
      if (round.status === 'win') audio.play('win')
      else audio.play('clear')
    }
    emitHud()
  }

  const tryPlace = (index: number): void => {
    if (onlineMode) {
      if (round.status !== 'playing' || round.turn !== myMark || round.board[index] !== null) {
        audio.play('click')
        return
      }
      online?.hooks.emit('move', { cell: index })
      return
    }
    if (round.status !== 'playing') return
    const next = reduceRound(round, { type: 'place', cell: index })
    if (next === round) {
      audio.play('click')
      return
    }
    placedAt[index] = clock
    round = next
    roundTimer = 0
    if (round.status === 'win') {
      audio.play('win')
      winT = settings.reducedMotion ? 1 : 0
    } else if (round.status === 'draw') {
      audio.play('clear')
    } else {
      audio.play('move')
    }
    emitHud()
  }

  const pollInput = (): void => {
    let col = cursor % SIZE
    let row = Math.floor(cursor / SIZE)
    if (input.pressed(0, 'left')) col = Math.max(0, col - 1)
    if (input.pressed(0, 'right')) col = Math.min(SIZE - 1, col + 1)
    if (input.pressed(0, 'up')) row = Math.max(0, row - 1)
    if (input.pressed(0, 'down')) row = Math.min(SIZE - 1, row + 1)
    cursor = row * SIZE + col
    if (input.pressed(0, 'action')) tryPlace(cursor)
  }

  const onPointer = (event: PointerEvent): void => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const x = (event.clientX - rect.left) * (width / rect.width)
    const y = (event.clientY - rect.top) * (height / rect.height)
    const col = Math.floor((x - boardX) / cell)
    const row = Math.floor((y - boardY) / cell)
    if (!Number.isInteger(col) || !Number.isInteger(row)) return
    if (col < 0 || col >= SIZE || row < 0 || row >= SIZE) return
    cursor = row * SIZE + col
    tryPlace(cursor)
  }

  canvas.addEventListener('pointerdown', onPointer)
  emitHud()

  if (online && onlineMode) {
    unsubscribe = online.hooks.subscribe((msg) => {
      if (msg.type !== 'state') return
      const state = toServerState(msg.data)
      if (state) applyServer(state)
    })
  }

  return {
    update(dt: number): void {
      clock += dt
      pollInput()
      if (onlineMode) {
        if (round.status === 'win') {
          winT = settings.reducedMotion ? 1 : Math.min(1, winT + dt / WIN_DUR)
        }
        if (round.status !== 'playing' && !overSent) {
          roundTimer += dt
          const delay = settings.reducedMotion ? ROUND_DELAY_REDUCED : ROUND_DELAY
          if (roundTimer >= delay) sendGameOver()
        }
        return
      }
      if (round.status === 'win') {
        winT = settings.reducedMotion ? 1 : Math.min(1, winT + dt / WIN_DUR)
      }
      if (round.status === 'playing') return
      roundTimer += dt
      const delay = settings.reducedMotion ? ROUND_DELAY_REDUCED : ROUND_DELAY
      if (roundTimer < delay) return
      round = reduceRound(round, { type: 'nextRound' })
      roundTimer = 0
      winT = 0
      placedAt.fill(-MARK_DUR)
    },

    render(ctx: CanvasRenderingContext2D): void {
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, width, height)

      const focus: Mark = round.winner ?? round.turn
      const statusText =
        round.status === 'draw'
          ? 'Draw'
          : round.status === 'win'
            ? `${focus} wins`
            : `${focus} turn`
      const statusColor = round.status === 'draw' ? TEXT_COLOR : MARK_COLOR[focus]

      ctx.font = `600 ${fontPx}px ui-sans-serif, system-ui, sans-serif`
      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = TEXT_COLOR
      ctx.textAlign = 'left'
      ctx.fillText(`Round ${round.round}`, boardX, bar * 0.68)
      ctx.textAlign = 'right'
      ctx.fillStyle = statusColor
      ctx.fillText(statusText, boardX + boardSize, bar * 0.68)

      ctx.fillStyle = GAP
      roundRect(ctx, boardX, boardY, boardSize, boardSize, cell * 0.14)
      ctx.fill()

      ctx.fillStyle = CELL_BG
      for (let row = 0; row < SIZE; row++) {
        for (let col = 0; col < SIZE; col++) {
          const x = boardX + col * cell + gap / 2
          const y = boardY + row * cell + gap / 2
          roundRect(ctx, x, y, cell - gap, cell - gap, cell * 0.12)
          ctx.fill()
        }
      }

      if (round.status === 'playing') {
        const col = cursor % SIZE
        const row = Math.floor(cursor / SIZE)
        const pulse = settings.reducedMotion ? 0.9 : 0.62 + 0.28 * Math.sin(clock * 6)
        ctx.globalAlpha = pulse
        ctx.strokeStyle = MARK_COLOR[round.turn]
        ctx.lineWidth = Math.max(2, cell * 0.05)
        const inset = ctx.lineWidth
        roundRect(
          ctx,
          boardX + col * cell + inset,
          boardY + row * cell + inset,
          cell - inset * 2,
          cell - inset * 2,
          cell * 0.1,
        )
        ctx.stroke()
        ctx.globalAlpha = 1
      }

      const lineWidth = Math.max(3, cell * 0.08)
      for (let index = 0; index < CELL_COUNT; index++) {
        const mark = round.board[index]
        if (!mark) continue
        const age = clock - placedAt[index]
        const t = settings.reducedMotion ? 1 : Math.min(1, Math.max(0, age / MARK_DUR))
        const eased = 1 - (1 - t) * (1 - t)
        const scale = 0.55 + 0.45 * eased
        const rise = (1 - eased) * cell * 0.1
        const center = centerOf(index)
        ctx.save()
        ctx.translate(center.x, center.y + rise)
        ctx.scale(scale, scale)
        ctx.globalAlpha = eased
        ctx.strokeStyle = MARK_COLOR[mark]
        ctx.lineWidth = lineWidth
        ctx.lineCap = 'round'
        ctx.beginPath()
        if (mark === 'X') {
          const inset = cell * 0.24
          ctx.moveTo(-inset, -inset)
          ctx.lineTo(inset, inset)
          ctx.moveTo(inset, -inset)
          ctx.lineTo(-inset, inset)
        } else {
          ctx.arc(0, 0, cell * 0.27, 0, Math.PI * 2)
        }
        ctx.stroke()
        ctx.restore()
      }

      if (round.status === 'win' && round.winLine) {
        const from = centerOf(round.winLine[0])
        const to = centerOf(round.winLine[2])
        const dx = to.x - from.x
        const dy = to.y - from.y
        const len = Math.hypot(dx, dy) || 1
        const ux = (dx / len) * cell * 0.16
        const uy = (dy / len) * cell * 0.16
        const sx = from.x - ux
        const sy = from.y - uy
        const ex = to.x + ux
        const ey = to.y + uy
        ctx.strokeStyle = WIN_COLOR
        ctx.lineWidth = Math.max(5, cell * 0.14)
        ctx.lineCap = 'round'
        ctx.beginPath()
        ctx.moveTo(sx, sy)
        ctx.lineTo(sx + (ex - sx) * winT, sy + (ey - sy) * winT)
        ctx.stroke()
      }
    },

    destroy(): void {
      canvas.removeEventListener('pointerdown', onPointer)
      unsubscribe?.()
      unsubscribe = null
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
