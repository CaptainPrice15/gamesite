import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import App from '../../App'

type Frame = (t: number) => void

function installCanvasMock(): { calls: () => number } {
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

function installFrameDriver(): { step: (frames?: number) => void } {
  const queue: Frame[] = []
  let t = performance.now()
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

describe('snake game host', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/play/snake')
  })

  it('boots, renders frames and pauses on Escape', async () => {
    const canvas = installCanvasMock()
    const driver = installFrameDriver()

    render(<App />)

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Snake', level: 1 })).toBeTruthy()
    })

    await waitFor(() => {
      act(() => driver.step(3))
      expect(canvas.calls()).toBeGreaterThan(0)
    })

    act(() => driver.step(30))
    expect(canvas.calls()).toBeGreaterThan(0)

    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }))
    act(() => driver.step(3))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Paused' })).toBeTruthy()
    })

    // resume
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' }))
    act(() => driver.step(3))
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Paused' })).toBeNull()
    })

    window.history.pushState({}, '', '/')
    vi.unstubAllGlobals()
  })
})
