import { describe, expect, it } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import App from '../App'

describe('app shell', () => {
  it('renders the homepage with the snake game card', async () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Snake' })).toBeTruthy()
    })
  })

  it('shows an unknown-game fallback for bad routes', async () => {
    window.history.pushState({}, '', '/play/does-not-exist')
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /unknown game/i })).toBeTruthy()
    })
    window.history.pushState({}, '', '/')
  })

  it('navigates to settings', async () => {
    window.history.pushState({}, '', '/settings')
    render(<App />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeTruthy()
    })
    window.history.pushState({}, '', '/')
  })
})
