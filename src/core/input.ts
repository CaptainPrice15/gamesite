import type { Action, PlayerIndex } from './types'

export const DEFAULT_KEY_MAP: Record<PlayerIndex, Partial<Record<Action, string[]>>> = {
  0: {
    up: ['ArrowUp', 'KeyW'],
    down: ['ArrowDown', 'KeyS'],
    left: ['ArrowLeft', 'KeyA'],
    right: ['ArrowRight', 'KeyD'],
    action: ['Space', 'Enter'],
    pause: ['Escape', 'KeyP'],
    special: ['ShiftLeft', 'KeyC'],
  },
  1: {
    up: ['ArrowUp', 'KeyI'],
    down: ['ArrowDown', 'KeyK'],
    left: ['ArrowLeft', 'KeyJ'],
    right: ['ArrowRight', 'KeyL'],
    action: ['Enter'],
    pause: ['Escape'],
    special: ['ShiftRight'],
  },
}

const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'action', 'pause', 'special']
const PULSE_MS = 170

/**
 * Semantic input across keyboard, touch (swipe + virtual pads) and gamepads.
 *
 * - `down()`   → held state (poll every step)
 * - `pressed()` → rising edge, visible for exactly one step (call endFrame() after update)
 */
export class InputManager {
  private keys = new Set<string>()
  private virtual: [Set<Action>, Set<Action>] = [new Set(), new Set()]
  private edges: [Set<Action>, Set<Action>] = [new Set(), new Set()]
  private pulses: [Partial<Record<Action, number>>, Partial<Record<Action, number>>] = [{}, {}]
  private maps: Record<PlayerIndex, Partial<Record<Action, string[]>>> = {
    0: { ...DEFAULT_KEY_MAP[0] },
    1: { ...DEFAULT_KEY_MAP[1] },
  }
  private gamepadEnabled: boolean
  private gamepadPrev: boolean[][] = ACTIONS.map(() => [false, false])
  private gamepadNow: boolean[][] = ACTIONS.map(() => [false, false])
  private detachFns: (() => void)[] = []
  private swipeDetach: (() => void) | null = null

  constructor(opts: { enableGamepad?: boolean } = {}) {
    this.gamepadEnabled = opts.enableGamepad !== false
    if (typeof window !== 'undefined') {
      const onKeyDown = (e: KeyboardEvent) => {
        if (e.repeat || isTypingTarget(e.target)) return
        this.keys.add(e.code)
        this.markEdgesForCode(e.code)
        if (shouldPreventDefault(e)) e.preventDefault()
      }
      const onKeyUp = (e: KeyboardEvent) => {
        this.keys.delete(e.code)
      }
      const onBlur = () => this.keys.clear()
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      window.addEventListener('blur', onBlur)
      this.detachFns.push(() => {
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('keyup', onKeyUp)
        window.removeEventListener('blur', onBlur)
      })
    }
  }

  private markEdgesForCode(code: string): void {
    for (const p of [0, 1] as PlayerIndex[]) {
      for (const [action, keys] of Object.entries(this.maps[p])) {
        if (keys?.includes(code)) this.edges[p].add(action as Action)
      }
    }
  }

  bindKeys(player: PlayerIndex, map: Partial<Record<Action, string[]>>): void {
    this.maps[player] = { ...DEFAULT_KEY_MAP[player], ...map }
  }

  resetKeys(): void {
    this.maps[0] = { ...DEFAULT_KEY_MAP[0] }
    this.maps[1] = { ...DEFAULT_KEY_MAP[1] }
  }

  down(player: PlayerIndex, action: Action): boolean {
    if (this.virtual[player].has(action)) return true
    const pulseUntil = this.pulses[player][action]
    if (pulseUntil !== undefined) {
      if (Date.now() < pulseUntil) return true
      delete this.pulses[player][action]
    }
    if (this.gamepadEnabled && this.gamepadNow[ACTIONS.indexOf(action)][player]) return true
    return (this.maps[player][action] ?? []).some((code) => this.keys.has(code))
  }

  pressed(player: PlayerIndex, action: Action): boolean {
    return this.edges[player].has(action)
  }

  setVirtual(player: PlayerIndex, action: Action, isDown: boolean): void {
    if (isDown) {
      if (!this.virtual[player].has(action)) this.edges[player].add(action)
      this.virtual[player].add(action)
    } else {
      this.virtual[player].delete(action)
    }
  }

  pulse(player: PlayerIndex, action: Action): void {
    this.pulses[player][action] = Date.now() + PULSE_MS
    this.edges[player].add(action)
  }

  /** Call at the start of every fixed step (polls gamepads). */
  beginFrame(): void {
    this.pollGamepads()
  }

  /** Call after the game consumed input for this step — clears one-step edges. */
  endFrame(): void {
    this.edges[0].clear()
    this.edges[1].clear()
  }

  clear(): void {
    this.keys.clear()
    this.virtual[0].clear()
    this.virtual[1].clear()
    this.pulses = [{}, {}]
    this.edges[0].clear()
    this.edges[1].clear()
  }

  private pollGamepads(): void {
    if (!this.gamepadEnabled || typeof navigator === 'undefined' || !navigator.getGamepads) return
    const pads = navigator.getGamepads()
    for (let p = 0; p < 2; p++) {
      const pad = pads[p]
      const axisY = pad ? (pad.axes[1] ?? 0) : 0
      const axisX = pad ? (pad.axes[0] ?? 0) : 0
      this.gamepadNow[0][p] = !!pad && (axisY < -0.4 || !!pad.buttons[12]?.pressed)
      this.gamepadNow[1][p] = !!pad && (axisY > 0.4 || !!pad.buttons[13]?.pressed)
      this.gamepadNow[2][p] = !!pad && (axisX < -0.4 || !!pad.buttons[14]?.pressed)
      this.gamepadNow[3][p] = !!pad && (axisX > 0.4 || !!pad.buttons[15]?.pressed)
      this.gamepadNow[4][p] = !!pad && !!pad.buttons[0]?.pressed
      this.gamepadNow[5][p] = !!pad && !!pad.buttons[9]?.pressed
      for (let a = 0; a < ACTIONS.length; a++) {
        if (this.gamepadNow[a][p] && !this.gamepadPrev[a][p]) {
          this.edges[p].add(ACTIONS[a])
        }
        this.gamepadPrev[a][p] = this.gamepadNow[a][p]
      }
    }
  }

  /** Swipe gestures on the game surface → directional pulses for player 0. */
  attachSwipe(el: HTMLElement, threshold = 28): void {
    this.detachSwipe()
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0]
      if (!t) return
      this.swipeStart = { x: t.clientX, y: t.clientY }
    }
    const onEnd = (e: TouchEvent) => {
      const start = this.swipeStart
      this.swipeStart = null
      const t = e.changedTouches[0]
      if (!start || !t) return
      const dx = t.clientX - start.x
      const dy = t.clientY - start.y
      if (Math.max(Math.abs(dx), Math.abs(dy)) < threshold) return
      if (Math.abs(dx) > Math.abs(dy)) this.pulse(0, dx > 0 ? 'right' : 'left')
      else this.pulse(0, dy > 0 ? 'down' : 'up')
    }
    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchend', onEnd, { passive: true })
    this.swipeDetach = () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchend', onEnd)
      this.swipeDetach = null
    }
  }

  private swipeStart: { x: number; y: number } | null = null

  detachSwipe(): void {
    this.swipeDetach?.()
  }

  destroy(): void {
    this.detachSwipe()
    this.detachFns.forEach((fn) => fn())
    this.detachFns = []
    this.clear()
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function shouldPreventDefault(e: KeyboardEvent): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false
  if (e.code.startsWith('Arrow')) return true
  const target = e.target
  if (target instanceof HTMLElement && target.closest('button, a, [role="button"]')) return false
  return e.code === 'Space' || e.code === 'Enter'
}
