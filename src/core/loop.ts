export const STEP = 1 / 60
const MAX_STEPS = 5

/**
 * Fixed-timestep loop (60Hz accumulator) + one render per animation frame.
 * Identical simulation speed on 30Hz, 60Hz and 144Hz displays.
 */
export class GameLoop {
  private rafId = 0
  private last = 0
  private acc = 0
  private running = false

  constructor(
    private readonly update: (dt: number) => void,
    private readonly render: () => void,
    private readonly onStep?: () => void,
  ) {}

  start(): void {
    if (this.running || typeof requestAnimationFrame === 'undefined') return
    this.running = true
    this.last = performance.now()
    this.acc = 0
    const frame = (now: number) => {
      if (!this.running) return
      let delta = (now - this.last) / 1000
      this.last = now
      if (delta < 0) delta = 0
      if (delta > 0.25) delta = 0.25 // tab was hidden — don't fast-forward
      this.acc += delta
      let steps = 0
      while (this.acc >= STEP && steps < MAX_STEPS) {
        this.onStep?.()
        this.update(STEP)
        this.acc -= STEP
        steps++
      }
      if (this.acc >= STEP) this.acc = 0 // drop backlog rather than spiral
      this.render()
      this.rafId = requestAnimationFrame(frame)
    }
    this.rafId = requestAnimationFrame(frame)
  }

  stop(): void {
    this.running = false
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.rafId = 0
  }

  isRunning(): boolean {
    return this.running
  }
}
