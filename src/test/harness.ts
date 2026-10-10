import { vi } from 'vitest'

type Frame = (t: number) => void

export interface CanvasMock {
  calls: () => number
}

export function installCanvasMock(): CanvasMock {
  let fillRects = 0
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string | symbol) {
        if (prop === 'fillRect') return () => void fillRects++
        if (typeof prop === 'symbol') return undefined
        return () => undefined
      },
      set() {
        return true
      },
    },
  )
  HTMLCanvasElement.prototype.getContext = function () {
    return ctx as unknown as CanvasRenderingContext2D
  } as unknown as typeof HTMLCanvasElement.prototype.getContext
  return { calls: () => fillRects }
}

export interface FrameDriver {
  step: (frames?: number) => void
}

export function installFrameDriver(): FrameDriver {
  const queue: Frame[] = []
  let t = 0
  vi.stubGlobal('requestAnimationFrame', (cb: Frame) => {
    queue.push(cb)
    return queue.length
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    delete queue[id - 1]
  })
  return {
    step(frames = 1) {
      for (let i = 0; i < frames; i++) {
        t = Math.max(t, performance.now()) + 1000 / 60
        const pending = queue.splice(0, queue.length)
        pending.forEach((cb) => cb(t))
      }
    },
  }
}
