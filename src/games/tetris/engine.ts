import type { Action, Game, GameCreateArgs } from '../../core/types'
import type { Piece, PieceKind, TetrisState } from './logic'
import {
  BUFFER_ROWS,
  CLEAR_FLASH,
  COLS,
  DAS_DELAY,
  DAS_RATE,
  LOCK_DELAY,
  MAX_LOCK_RESETS,
  QUEUE_LENGTH,
  ROWS,
  SOFT_DROP_INTERVAL,
  TOTAL_ROWS,
  beginPlay,
  collides,
  createBoard,
  createInitialState,
  createPiece,
  finishClear,
  ghostY,
  gravityInterval,
  hardDrop,
  holdPiece,
  lockPiece,
  softDrop,
  tryMove,
  tryRotate,
  updateClear,
} from './logic'

const COLORS: Record<PieceKind, string> = {
  I: '#38bdf8',
  O: '#facc15',
  T: '#a78bfa',
  S: '#4ade80',
  Z: '#fb7185',
  J: '#60a5fa',
  L: '#fb923c',
}

const BG = '#0d1420'
const WELL = '#101a2a'
const GRID = 'rgba(255,255,255,0.05)'
const MUTED = 'rgba(255,255,255,0.45)'
const TEXT = '#e2e8f0'
const PANEL_BG = 'rgba(255,255,255,0.03)'
const SLOT_BG = 'rgba(255,255,255,0.04)'
const START_ACTIONS: Action[] = ['left', 'right', 'down', 'up', 'action', 'special']

interface Layout {
  pad: number
  cell: number
  boardX: number
  boardY: number
  panelX: number
  panelW: number
  slot: number
  font: number
}

function computeLayout(width: number, height: number): Layout {
  const pad = Math.max(4, Math.round(Math.min(width, height) * 0.02))
  const gap = Math.max(6, Math.round(pad * 1.4))
  const panelMin = Math.max(88, Math.round(width * 0.2))
  const cellByHeight = (height - pad * 2) / ROWS
  const cellByWidth = (width - panelMin - gap - pad) / COLS
  const cell = Math.max(4, Math.min(cellByHeight, cellByWidth))
  const boardW = cell * COLS
  const boardH = cell * ROWS
  const panelX = pad + boardW + gap
  const panelW = width - panelX - pad
  const avail = height - pad * 2
  const font = Math.max(10, Math.min(16, Math.round(avail / 40)))
  const statLine = Math.round(font * 1.35)
  const slot = Math.max(14, Math.min((avail - font * 2 - statLine * 3 - 28) / 6, panelW - 8))
  return {
    pad,
    cell,
    boardX: pad,
    boardY: Math.round((height - boardH) / 2),
    panelX,
    panelW,
    slot,
    font,
  }
}

function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
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

function drawBlock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const pad = Math.max(1, size * 0.06)
  const radius = Math.max(1.5, size * 0.18)
  const inner = size - pad * 2
  ctx.fillStyle = color
  roundRect(ctx, x + pad, y + pad, inner, inner, radius)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  roundRect(
    ctx,
    x + pad + inner * 0.16,
    y + pad + inner * 0.14,
    inner * 0.68,
    inner * 0.3,
    Math.max(1, inner * 0.14),
  )
  ctx.fill()
}

function drawGhostCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  const pad = Math.max(1.5, size * 0.1)
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1, size * 0.08)
  roundRect(ctx, x + pad, y + pad, size - pad * 2, size - pad * 2, Math.max(1.5, size * 0.16))
  ctx.stroke()
}

function drawPieceOnBoard(
  ctx: CanvasRenderingContext2D,
  piece: Piece,
  originY: number,
  boardX: number,
  boardY: number,
  cell: number,
  color: string,
  ghost: boolean,
): void {
  for (const offset of piece.cells) {
    const y = originY + offset.y
    const x = piece.x + offset.x
    if (x < 0 || x >= COLS || y < BUFFER_ROWS || y >= TOTAL_ROWS) continue
    const px = boardX + x * cell
    const py = boardY + (y - BUFFER_ROWS) * cell
    if (ghost) drawGhostCell(ctx, px, py, cell, color)
    else drawBlock(ctx, px, py, cell, color)
  }
}

function drawPreview(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  kind: PieceKind | null,
  cap: number,
): void {
  ctx.fillStyle = SLOT_BG
  roundRect(ctx, x, y, size, size, Math.max(3, size * 0.12))
  ctx.fill()
  if (!kind) return
  const cells = createPiece(kind).cells
  let minX = cells[0].x
  let maxX = cells[0].x
  let minY = cells[0].y
  let maxY = cells[0].y
  for (const cell of cells) {
    minX = Math.min(minX, cell.x)
    maxX = Math.max(maxX, cell.x)
    minY = Math.min(minY, cell.y)
    maxY = Math.max(maxY, cell.y)
  }
  const boxW = maxX - minX + 1
  const boxH = maxY - minY + 1
  const pad = Math.max(3, size * 0.14)
  const avail = size - pad * 2
  const block = Math.min(avail / boxW, avail / boxH, cap)
  const offX = x + (size - boxW * block) / 2
  const offY = y + (size - boxH * block) / 2
  for (const cell of cells) {
    drawBlock(
      ctx,
      offX + (cell.x - minX) * block,
      offY + (cell.y - minY) * block,
      block,
      COLORS[kind],
    )
  }
}

function drawStat(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  line: number,
  font: number,
  label: string,
  value: string,
): void {
  const dy = (line - font) / 2
  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  ctx.fillStyle = MUTED
  ctx.fillText(label, x, y + dy)
  ctx.textAlign = 'right'
  ctx.fillStyle = TEXT
  ctx.fillText(value, x + w, y + dy)
  ctx.textAlign = 'left'
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
  const state = createInitialState(rng)
  const layout = computeLayout(width, height)

  let ended = false
  let gravityAcc = 0
  let softAcc = 0
  let lockTimer = 0
  let lockResets = 0
  let dasDir: 'left' | 'right' | null = null
  let dasTimer = 0
  let dasCharged = false
  let moveSfx = 0
  let lastScore = -1
  let lastLevel = -1
  let lastLines = -1

  const emitHud = (): void => {
    if (state.score === lastScore && state.level === lastLevel && state.lines === lastLines) {
      return
    }
    lastScore = state.score
    lastLevel = state.level
    lastLines = state.lines
    events.onScore(state.score)
    events.onHud([
      { label: 'Score', value: state.score },
      { label: 'Level', value: state.level },
      { label: 'Lines', value: state.lines },
    ])
  }

  emitHud()

  const playMove = (): void => {
    if (moveSfx > 0) return
    audio.play('move')
    moveSfx = 0.06
  }

  const checkEnd = (): void => {
    if (!state.gameOver || ended) return
    ended = true
    audio.play('die')
    events.onScore(state.score)
    events.onGameOver({ score: state.score })
  }

  const resetLock = (): void => {
    const piece = state.piece
    if (!piece) return
    if (!collides(state.board, { ...piece, y: piece.y + 1 })) return
    if (lockResets >= MAX_LOCK_RESETS) return
    lockTimer = 0
    lockResets++
  }

  const lockNow = (): void => {
    const rows = lockPiece(state, rng)
    gravityAcc = 0
    lockTimer = 0
    lockResets = 0
    if (rows === 0) return
    audio.play(rows >= 4 ? 'clear' : 'line')
    if (settings.reducedMotion) finishClear(state, rng)
  }

  const shift = (dir: 'left' | 'right'): void => {
    if (!tryMove(state, dir === 'left' ? -1 : 1, 0)) return
    playMove()
    resetLock()
  }

  const handleDAS = (dt: number): void => {
    const left = input.down(0, 'left')
    const right = input.down(0, 'right')
    const dir = left && !right ? 'left' : right && !left ? 'right' : null
    if (dir !== dasDir) {
      dasDir = dir
      dasTimer = 0
      dasCharged = false
      if (dir) shift(dir)
      return
    }
    if (!dir) return
    dasTimer += dt
    if (!dasCharged) {
      if (dasTimer < DAS_DELAY) return
      dasCharged = true
      dasTimer = 0
      shift(dir)
      return
    }
    let guard = 0
    while (dasTimer >= DAS_RATE && guard < 6) {
      dasTimer -= DAS_RATE
      guard++
      shift(dir)
    }
  }

  const handleSoftDrop = (dt: number): void => {
    if (input.pressed(0, 'down') && softDrop(state)) resetLock()
    if (!input.down(0, 'down')) {
      softAcc = 0
      return
    }
    softAcc += dt
    let guard = 0
    while (softAcc >= SOFT_DROP_INTERVAL && state.piece && guard < 8) {
      softAcc -= SOFT_DROP_INTERVAL
      guard++
      if (!softDrop(state)) {
        softAcc = 0
        break
      }
      resetLock()
    }
  }

  const handleGravity = (dt: number): void => {
    gravityAcc += dt
    const interval = gravityInterval(state.level)
    let guard = 0
    while (gravityAcc >= interval && guard < 6) {
      gravityAcc -= interval
      guard++
      if (!tryMove(state, 0, 1)) {
        gravityAcc = 0
        break
      }
    }
  }

  const handleLock = (dt: number): void => {
    const piece = state.piece
    if (!piece) return
    if (!collides(state.board, { ...piece, y: piece.y + 1 })) {
      lockTimer = 0
      lockResets = 0
      return
    }
    lockTimer += dt
    if (lockTimer >= LOCK_DELAY) lockNow()
  }

  const wantsStart = (): boolean =>
    START_ACTIONS.some((action) => input.pressed(0, action) || input.down(0, action))

  const drawPanel = (ctx: CanvasRenderingContext2D): void => {
    const { pad, cell, panelX, panelW, slot, font } = layout
    ctx.fillStyle = PANEL_BG
    roundRect(ctx, panelX - 6, 4, panelW + 10, height - 8, 12)
    ctx.fill()
    const contentW = Math.max(slot, Math.min(150, panelW - 8))
    const contentX = panelX + (panelW - contentW) / 2
    const boxX = contentX + (contentW - slot) / 2
    const statLine = Math.round(font * 1.35)
    let y = pad
    ctx.font = `700 ${font}px system-ui, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = MUTED
    ctx.fillText('HOLD', contentX, y)
    y += font + 4
    ctx.globalAlpha = state.canHold ? 1 : 0.4
    drawPreview(ctx, boxX, y, slot, state.hold, cell * 1.15)
    ctx.globalAlpha = 1
    y += slot + 10
    ctx.fillText('NEXT', contentX, y)
    y += font + 4
    for (let i = 0; i < QUEUE_LENGTH; i++) {
      const kind = i < state.queue.length ? state.queue[i] : null
      drawPreview(ctx, boxX, y, slot, kind, cell * 1.15)
      y += slot
    }
    y += 10
    drawStat(ctx, contentX, y, contentW, statLine, font, 'Score', String(state.score))
    drawStat(ctx, contentX, y + statLine, contentW, statLine, font, 'Level', String(state.level))
    drawStat(
      ctx,
      contentX,
      y + statLine * 2,
      contentW,
      statLine,
      font,
      'Lines',
      String(state.lines),
    )
  }

  return {
    update(dt: number): void {
      if (ended) return
      moveSfx = Math.max(0, moveSfx - dt)

      if (state.attract) {
        if (!wantsStart()) return
        beginPlay(state)
      }

      if (state.clearRows.length > 0) {
        updateClear(state, dt, rng)
        emitHud()
        checkEnd()
        return
      }

      if (state.gameOver) {
        emitHud()
        checkEnd()
        return
      }

      if (!state.piece) return

      if (input.pressed(0, 'up') && tryRotate(state)) {
        playMove()
        resetLock()
      }

      if (input.pressed(0, 'special') && holdPiece(state, rng)) {
        audio.play('click')
        gravityAcc = 0
        lockTimer = 0
        lockResets = 0
      }

      if (state.gameOver) {
        emitHud()
        checkEnd()
        return
      }

      if (input.pressed(0, 'action')) {
        hardDrop(state)
        audio.play('bounce')
        lockNow()
      }

      if (state.gameOver || !state.piece) {
        emitHud()
        checkEnd()
        return
      }

      handleDAS(dt)
      handleSoftDrop(dt)
      handleGravity(dt)
      handleLock(dt)

      emitHud()
      checkEnd()
    },

    render(ctx: CanvasRenderingContext2D): void {
      ctx.fillStyle = BG
      ctx.fillRect(0, 0, width, height)

      const { cell, boardX, boardY } = layout
      const boardW = cell * COLS
      const boardH = cell * ROWS

      ctx.fillStyle = WELL
      ctx.fillRect(boardX, boardY, boardW, boardH)

      ctx.strokeStyle = GRID
      ctx.lineWidth = 1
      ctx.beginPath()
      for (let x = 1; x < COLS; x++) {
        const px = boardX + x * cell
        ctx.moveTo(px, boardY)
        ctx.lineTo(px, boardY + boardH)
      }
      for (let y = 1; y < ROWS; y++) {
        const py = boardY + y * cell
        ctx.moveTo(boardX, py)
        ctx.lineTo(boardX + boardW, py)
      }
      ctx.stroke()

      for (let y = BUFFER_ROWS; y < TOTAL_ROWS; y++) {
        const row = state.board[y]
        for (let x = 0; x < COLS; x++) {
          const kind = row[x]
          if (kind) {
            drawBlock(ctx, boardX + x * cell, boardY + (y - BUFFER_ROWS) * cell, cell, COLORS[kind])
          }
        }
      }

      if (state.clearRows.length > 0 && !settings.reducedMotion) {
        const t = 1 - Math.max(0, state.clearTimer) / CLEAR_FLASH
        ctx.fillStyle = `rgba(255,255,255,${(0.3 + t * 0.7).toFixed(3)})`
        for (const y of state.clearRows) {
          if (y < BUFFER_ROWS) continue
          ctx.fillRect(boardX, boardY + (y - BUFFER_ROWS) * cell, boardW, cell)
        }
      }

      const piece = state.piece
      if (piece) {
        if (!state.gameOver) {
          const landing = ghostY(state)
          if (landing > piece.y) {
            drawPieceOnBoard(
              ctx,
              piece,
              landing,
              boardX,
              boardY,
              cell,
              withAlpha(COLORS[piece.kind], 0.55),
              true,
            )
          }
        }
        drawPieceOnBoard(ctx, piece, piece.y, boardX, boardY, cell, COLORS[piece.kind], false)
      }

      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 2
      ctx.strokeRect(boardX + 1, boardY + 1, boardW - 2, boardH - 2)

      drawPanel(ctx)

      if (state.gameOver) {
        ctx.fillStyle = 'rgba(13,20,32,0.72)'
        ctx.fillRect(boardX, boardY, boardW, boardH)
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle = TEXT
        ctx.font = `700 ${Math.round(Math.max(14, cell * 1.1))}px system-ui, sans-serif`
        ctx.fillText('GAME OVER', boardX + boardW / 2, boardY + boardH / 2 - cell * 0.8)
        ctx.font = `600 ${Math.round(Math.max(11, cell * 0.7))}px system-ui, sans-serif`
        ctx.fillStyle = MUTED
        ctx.fillText(String(state.score), boardX + boardW / 2, boardY + boardH / 2 + cell * 0.8)
        ctx.textAlign = 'left'
        ctx.textBaseline = 'top'
      }
    },

    destroy(): void {
      state.board = createBoard()
      state.piece = null
      state.queue = []
      state.clearRows = []
      state.clearTimer = 0
    },

    serialize(): TetrisState {
      return { ...state }
    },
  }
}
