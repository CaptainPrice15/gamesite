import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import type {
  Action,
  Game,
  GameModule,
  GameResult,
  GameSettings,
  HudValue,
  OnlineSetup,
} from '../core/types'
import { GameLoop } from '../core/loop'
import { InputManager } from '../core/input'
import { getAudio } from '../core/audio'
import { loadBest, saveBest } from '../core/storage'
import { mulberry32, randomSeed } from '../core/rng'
import { useSettings } from '../core/settings'
import { submitScore } from '../lib/submit'
import { supabase } from '../lib/supabase'
import { Modal } from './Modal'

type Phase = 'loading' | 'playing' | 'paused' | 'over'

const PADLESS_GAMES = new Set(['2048', 'ttt'])
const DISCONNECT_GRACE_S = 90

interface PadButtonProps {
  inputRef: RefObject<InputManager | null>
  player: 0 | 1
  action: Action
  label: string
  glyph: string
}

function PadButton({ inputRef, player, action, label, glyph }: PadButtonProps): ReactNode {
  const change = (down: boolean) => (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (down) {
      event.preventDefault()
      event.currentTarget.setPointerCapture?.(event.pointerId)
    }
    inputRef.current?.setVirtual(player, action, down)
  }
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={change(true)}
      onPointerUp={change(false)}
      onPointerCancel={change(false)}
      onContextMenu={(event) => event.preventDefault()}
    >
      {glyph}
    </button>
  )
}

interface GameHostProps {
  game: GameModule
  onExit: () => void
  onFriendMatch?: () => void
  online?: OnlineSetup
  connection?: { opponentPresent: boolean }
  resultNote?: string | null
  onGameOver?: (result: {
    score: number
    best: number
    isRecord: boolean
    meta?: Record<string, unknown>
  }) => void
}

export function GameHost({
  game,
  onExit,
  onFriendMatch,
  online,
  connection,
  resultNote,
  onGameOver,
}: GameHostProps): ReactNode {
  const { settings } = useSettings()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const inputRef = useRef<InputManager | null>(null)
  const instanceRef = useRef<Game | null>(null)
  const loopRef = useRef<GameLoop | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const phaseRef = useRef<Phase>('loading')
  const scoreRef = useRef(0)
  const runStartRef = useRef(0)
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  const onlineRef = useRef(online)
  onlineRef.current = online
  const droppedRef = useRef(false)
  const dropTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dropTickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Live view of settings so a running game always sees current values.
  const liveSettings = useMemo(
    () =>
      new Proxy({} as GameSettings, {
        get: (_t, prop: string) => settingsRef.current[prop as keyof GameSettings],
      }),
    [],
  )

  const [phase, setPhase] = useState<Phase>('loading')
  const [hud, setHud] = useState<HudValue[]>([])
  const [best, setBest] = useState(() => loadBest(game.id))
  const [record, setRecord] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [lastScore, setLastScore] = useState(0)
  const [rank, setRank] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [portrait, setPortrait] = useState(false)
  const [overTitle, setOverTitle] = useState('Game over')
  const [dropped, setDropped] = useState(false)
  const [dropCountdown, setDropCountdown] = useState(DISCONNECT_GRACE_S)

  const setPhaseSafe = useCallback((p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }, [])

  const clearDropTimers = useCallback(() => {
    if (dropTimerRef.current !== null) {
      clearTimeout(dropTimerRef.current)
      dropTimerRef.current = null
    }
    if (dropTickRef.current !== null) {
      clearInterval(dropTickRef.current)
      dropTickRef.current = null
    }
  }, [])

  const handleGameOver = useCallback(
    (result: GameResult) => {
      scoreRef.current = result.score
      const { best: newBest, isRecord } = saveBest(game.id, result.score)
      setBest(newBest)
      setRecord(isRecord)
      setLastScore(result.score)
      const winner = result.meta?.winner
      setOverTitle(
        result.win === undefined
          ? 'Game over'
          : winner === null || winner === undefined
            ? 'Draw'
            : result.win
              ? 'Victory'
              : 'Defeat',
      )
      setPhaseSafe('over')
      clearDropTimers()
      droppedRef.current = false
      setDropped(false)
      onGameOver?.({ score: result.score, best: newBest, isRecord, meta: result.meta })
      if (game.players === 1 && result.score > 0) {
        const durationMs = Math.max(1, Date.now() - runStartRef.current)
        void submitScore(game.id, result.score, { durationMs }).then((res) => {
          if (!res.ok) return
          setSubmitted(true)
          if (res.rank !== undefined) setRank(res.rank)
        })
      }
    },
    [clearDropTimers, game.id, game.players, onGameOver, setPhaseSafe],
  )

  const boot = useCallback(async () => {
    const canvas = canvasRef.current
    if (!canvas) return

    loopRef.current?.stop()
    instanceRef.current?.destroy()
    instanceRef.current = null
    inputRef.current?.clear()

    const { create } = await game.load()
    if (!canvasRef.current) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(game.width * dpr)
    canvas.height = Math.round(game.height * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctxRef.current = ctx

    const audio = getAudio()
    audio.resume()

    const input = inputRef.current ?? new InputManager()
    inputRef.current = input

    scoreRef.current = 0
    runStartRef.current = Date.now()
    setRecord(false)
    setLastScore(0)
    setRank(null)
    setSubmitted(false)

    instanceRef.current = create({
      width: game.width,
      height: game.height,
      canvas,
      input,
      audio,
      rng: mulberry32(randomSeed()),
      settings: liveSettings,
      events: {
        onScore: (value: number) => {
          scoreRef.current = value
        },
        onHud: setHud,
        onGameOver: handleGameOver,
      },
      online: onlineRef.current,
    })

    const loop = new GameLoop(
      (dt) => {
        const inputManager = inputRef.current
        if (!inputManager) return
        inputManager.beginFrame()
        if (inputManager.pressed(0, 'pause')) {
          inputManager.endFrame()
          if (phaseRef.current === 'playing') setPhaseSafe('paused')
          else if (phaseRef.current === 'paused') setPhaseSafe('playing')
          return
        }
        if (phaseRef.current === 'playing' && !droppedRef.current) {
          instanceRef.current?.update(dt)
        }
        inputManager.endFrame()
      },
      () => instanceRef.current?.render(ctx),
    )
    loopRef.current = loop
    loop.start()
    setPhaseSafe('playing')
  }, [game, handleGameOver, liveSettings, setPhaseSafe])

  useEffect(() => {
    let cancelled = false
    const input = new InputManager()
    inputRef.current = input
    const canvas = canvasRef.current
    if (canvas) input.attachSwipe(canvas)

    const resume = (): void => getAudio().resume()
    window.addEventListener('pointerdown', resume)
    window.addEventListener('keydown', resume)

    void boot().catch((err) => {
      if (!cancelled) console.error('[arcade] failed to boot game', err)
    })

    return () => {
      cancelled = true
      window.removeEventListener('pointerdown', resume)
      window.removeEventListener('keydown', resume)
      loopRef.current?.stop()
      instanceRef.current?.destroy()
      instanceRef.current = null
      input.destroy()
      inputRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // fit canvas into its wrapper
  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    const resize = (): void => {
      const cw = wrap.clientWidth
      const ch = wrap.clientHeight
      if (cw === 0 || ch === 0) return
      const ar = game.width / game.height
      let w = cw
      let h = cw / ar
      if (h > ch) {
        h = ch
        w = ch * ar
      }
      canvas.style.width = `${Math.floor(w)}px`
      canvas.style.height = `${Math.floor(h)}px`
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [game.width, game.height])

  // auto-pause when the tab is hidden or the window loses focus
  useEffect(() => {
    const pause = (): void => {
      if (phaseRef.current === 'playing') setPhaseSafe('paused')
    }
    document.addEventListener('visibilitychange', pause)
    window.addEventListener('blur', pause)
    return () => {
      document.removeEventListener('visibilitychange', pause)
      window.removeEventListener('blur', pause)
    }
  }, [setPhaseSafe])

  const forceForfeit = useCallback(() => {
    clearDropTimers()
    droppedRef.current = false
    setDropped(false)
    const role = onlineRef.current?.role
    if (!role || phaseRef.current !== 'playing') return
    const winner = game.id === 'ttt' ? (role === 'p1' ? 1 : 2) : role
    handleGameOver({
      score: scoreRef.current,
      win: true,
      meta: { winner, forfeit: true },
    })
  }, [clearDropTimers, game.id, handleGameOver])

  useEffect(() => {
    if (!connection) return
    if (connection.opponentPresent) {
      if (droppedRef.current || dropTimerRef.current !== null) {
        clearDropTimers()
        droppedRef.current = false
        setDropped(false)
      }
      return
    }
    if (phaseRef.current !== 'playing' || droppedRef.current) return
    droppedRef.current = true
    setDropped(true)
    setDropCountdown(DISCONNECT_GRACE_S)
    dropTickRef.current = setInterval(() => {
      setDropCountdown((prev) => Math.max(0, prev - 1))
    }, 1000)
    dropTimerRef.current = setTimeout(() => forceForfeit(), DISCONNECT_GRACE_S * 1000)
  }, [connection, phase, clearDropTimers, forceForfeit])

  useEffect(() => clearDropTimers, [clearDropTimers])

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)')
    const sync = (): void => setPortrait(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  const padSide = settings.leftHanded ? 'right' : 'left'
  const actionSide = settings.leftHanded ? 'left' : 'right'
  const padPlayer: 0 | 1 = online?.role === 'p2' ? 1 : 0
  const showPad = phase === 'playing' && !PADLESS_GAMES.has(game.id)
  const hasAction = game.controls.some((c) => c.action === 'action')
  const hasSpecial = game.controls.some((c) => c.action === 'special')
  const showActionCluster = showPad && (hasAction || hasSpecial)

  const restart = useCallback(() => {
    void boot()
  }, [boot])

  const resume = useCallback(() => {
    getAudio().resume()
    setPhaseSafe('playing')
  }, [setPhaseSafe])

  return (
    <div className="game-host">
      <div className="game-topbar">
        <button className="icon-btn" onClick={onExit} aria-label="Leave game">
          ←
        </button>
        <h1 className="game-title">{game.title}</h1>
        <div className="hud">
          {hud.map((item) => (
            <span className="hud-chip" key={item.label}>
              <span className="hud-label">{item.label}</span>
              <span className="hud-value">{item.value}</span>
            </span>
          ))}
        </div>
        <div className="row gap">
          {onFriendMatch && game.online && supabase && (
            <button
              className="icon-btn"
              onClick={onFriendMatch}
              aria-label="Play with a friend"
              title="Play with a friend"
            >
              vs
            </button>
          )}
          <button className="icon-btn" onClick={() => setShowHelp(true)} aria-label="How to play">
            ?
          </button>
          <button
            className="icon-btn"
            onClick={() => (phase === 'playing' ? setPhaseSafe('paused') : resume())}
            aria-label={phase === 'playing' ? 'Pause' : 'Resume'}
          >
            {phase === 'playing' ? '❚❚' : '▶'}
          </button>
        </div>
      </div>

      <div className="game-stage" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="game-canvas"
          aria-label={`${game.title} play area`}
          role="img"
        />

        {phase === 'loading' && (
          <div className="stage-overlay">
            <p className="muted">Loading…</p>
          </div>
        )}

        {phase === 'paused' && (
          <div className="stage-overlay">
            <div className="overlay-card">
              <h2>Paused</h2>
              <div className="col gap">
                <button className="btn primary" onClick={resume}>
                  Resume
                </button>
                {!online && (
                  <button className="btn" onClick={restart}>
                    Restart
                  </button>
                )}
                <button className="btn ghost" onClick={() => setShowHelp(true)}>
                  How to play
                </button>
                <button className="btn ghost" onClick={onExit}>
                  Exit to arcade
                </button>
              </div>
            </div>
          </div>
        )}

        {phase === 'playing' && dropped && (
          <div className="stage-overlay">
            <div className="overlay-card">
              <h2>Opponent disconnected</h2>
              <p className="muted">
                Waiting to reconnect — win by forfeit in {dropCountdown}s if they don&apos;t return.
              </p>
            </div>
          </div>
        )}

        {phase === 'over' && (
          <div className="stage-overlay">
            <div className="overlay-card">
              <h2>{overTitle}</h2>
              <p className="score-line">
                {lastScore}
                {record && <span className="record-badge">NEW BEST</span>}
              </p>
              <p className="muted">Best {best}</p>
              {submitted && (
                <p className="leader-line">
                  {rank !== null ? `Global rank #${rank}` : 'On the global leaderboard'}
                </p>
              )}
              {resultNote && <p className="leader-line">{resultNote}</p>}
              <div className="col gap">
                {!online && (
                  <button className="btn primary" onClick={restart}>
                    Play again
                  </button>
                )}
                <button className={`btn ${online ? 'primary' : 'ghost'}`} onClick={onExit}>
                  {online ? 'Back to lobby' : 'Exit to arcade'}
                </button>
              </div>
            </div>
          </div>
        )}

        {game.id === 'pong' && portrait && phase === 'playing' && (
          <div className="rotate-hint" role="status">
            ↻ Rotate to landscape for the full court
          </div>
        )}

        {showPad && (
          <>
            <div className={`dpad ${padSide}`} role="group" aria-label="Touch d-pad">
              <span aria-hidden="true" />
              <PadButton
                inputRef={inputRef}
                player={padPlayer}
                action="up"
                label="Move up"
                glyph="▲"
              />
              <span aria-hidden="true" />
              <PadButton
                inputRef={inputRef}
                player={padPlayer}
                action="left"
                label="Move left"
                glyph="◀"
              />
              <span aria-hidden="true" />
              <PadButton
                inputRef={inputRef}
                player={padPlayer}
                action="right"
                label="Move right"
                glyph="▶"
              />
              <span aria-hidden="true" />
              <PadButton
                inputRef={inputRef}
                player={padPlayer}
                action="down"
                label="Move down"
                glyph="▼"
              />
              <span aria-hidden="true" />
            </div>
            {showActionCluster && (
              <div className={`pad-actions ${actionSide}`} role="group" aria-label="Touch buttons">
                {hasAction && (
                  <PadButton
                    inputRef={inputRef}
                    player={padPlayer}
                    action="action"
                    label="Action button"
                    glyph="A"
                  />
                )}
                {hasSpecial && (
                  <PadButton
                    inputRef={inputRef}
                    player={padPlayer}
                    action="special"
                    label="Special button"
                    glyph="B"
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      {settings.showControls && (
        <div className="controls-legend" aria-label="Controls">
          {game.controls.map((c) => (
            <span className="legend-item" key={`${c.action}-${c.label}`}>
              <kbd>{c.keys.join(' / ')}</kbd> {c.label}
            </span>
          ))}
        </div>
      )}

      {showHelp && (
        <Modal title={`How to play ${game.title}`} onClose={() => setShowHelp(false)}>
          <ol className="howto">
            {game.howToPlay.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ol>
          <h3>Controls</h3>
          <ul className="controls-list">
            {game.controls.map((c) => (
              <li key={`${c.action}-${c.label}`}>
                <kbd>{c.keys.join(' + ')}</kbd>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Tip: swipe on the board on mobile. Your local best score is saved on this device.
          </p>
        </Modal>
      )}
    </div>
  )
}
