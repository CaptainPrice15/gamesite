import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import App from '../App'
import { GAMES } from '../games/registry'
import { installCanvasMock, installFrameDriver, type CanvasMock, type FrameDriver } from './harness'

describe('every game boots', () => {
  let canvas: CanvasMock
  let driver: FrameDriver

  beforeEach(() => {
    canvas = installCanvasMock()
    driver = installFrameDriver()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.history.pushState({}, '', '/')
  })

  for (const game of GAMES) {
    it(`${game.id} renders frames without crashing`, async () => {
      window.history.pushState({}, '', `/play/${game.id}`)

      render(<App />)

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: game.title, level: 1 })).toBeTruthy()
      })

      await waitFor(() => {
        act(() => driver.step(3))
        expect(canvas.calls()).toBeGreaterThan(0)
      })

      act(() => driver.step(60))
      expect(canvas.calls()).toBeGreaterThan(0)
      expect(document.querySelector('.game-canvas')).toBeTruthy()
    })
  }
})
