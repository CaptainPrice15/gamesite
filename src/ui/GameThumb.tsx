import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GameModule } from '../core/types'

const cache = new Map<string, string>()

/** Renders each game's attract frame to an offscreen canvas → data URL (no image assets). */
export function GameThumb({ game }: { game: GameModule }): ReactNode {
  const [src, setSrc] = useState<string | null>(() => cache.get(game.id) ?? null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (src) return
    let cancelled = false

    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        io.disconnect()
        void (async () => {
          try {
            const [{ create }, { mulberry32 }] = await Promise.all([
              game.load(),
              import('../core/rng'),
            ])
            if (cancelled) return
            const W = 480
            const H = 320
            const canvas = document.createElement('canvas')
            canvas.width = W
            canvas.height = H
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            const noops = (): void => undefined
            const instance = create({
              width: W,
              height: H,
              canvas,
              input: { down: () => false, pressed: () => false },
              audio: { play: noops, resume: noops },
              rng: mulberry32(0xc0ffee),
              settings: {
                masterVolume: 0,
                musicVolume: 0,
                sfxVolume: 0,
                difficulty: 'normal',
                wrapWalls: false,
                leftHanded: false,
                reducedMotion: true,
                showControls: true,
              },
              events: { onScore: noops, onHud: noops, onGameOver: noops },
            })
            for (let i = 0; i < 30; i++) instance.update(1 / 60)
            instance.render(ctx)
            instance.destroy()
            const url = canvas.toDataURL('image/webp', 0.85)
            cache.set(game.id, url)
            if (!cancelled) setSrc(url)
          } catch (err) {
            console.warn('[arcade] thumbnail failed', err)
          }
        })()
      },
      { rootMargin: '200px' },
    )
    if (ref.current) io.observe(ref.current)
    return () => {
      cancelled = true
      io.disconnect()
    }
  }, [game, src])

  return (
    <div className="thumb" style={{ ['--accent' as string]: game.accent }} ref={ref}>
      {src ? (
        <img src={src} alt="" loading="lazy" width={480} height={320} />
      ) : (
        <div className="thumb-ph" aria-hidden="true" />
      )}
    </div>
  )
}
