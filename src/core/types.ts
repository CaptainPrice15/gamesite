export type Action = 'up' | 'down' | 'left' | 'right' | 'action' | 'pause' | 'special'

export type PlayerIndex = 0 | 1

export interface HudValue {
  label: string
  value: string | number
}

export interface GameResult {
  score: number
  win?: boolean
  meta?: Record<string, unknown>
}

export interface GameEvents {
  onScore(score: number): void
  onHud(hud: HudValue[]): void
  onGameOver(result: GameResult): void
  onPaused?(paused: boolean): void
}

export type Difficulty = 'easy' | 'normal' | 'hard'

export interface GameSettings {
  masterVolume: number
  musicVolume: number
  sfxVolume: number
  difficulty: Difficulty
  wrapWalls: boolean
  leftHanded: boolean
  reducedMotion: boolean
  showControls: boolean
}

export interface InputLike {
  down(player: PlayerIndex, action: Action): boolean
  pressed(player: PlayerIndex, action: Action): boolean
  /** Optional per-game key remapping (e.g. hotseat Pong: W/S vs arrows). */
  bindKeys?(player: PlayerIndex, map: Partial<Record<Action, string[]>>): void
}

/** Messaging bridge for online matches (Phase 4) — emit local events, receive remote. */
export interface NetHooks {
  emit(type: string, data: unknown): void
  subscribe(cb: (msg: { type: string; data: unknown }) => void): () => void
}

export interface OnlineSetup {
  role: 'p1' | 'p2'
  hooks: NetHooks
  initial?: unknown
}

export interface GameCreateArgs {
  width: number
  height: number
  canvas: HTMLCanvasElement
  input: InputLike
  audio: AudioLike
  rng: () => number
  settings: GameSettings
  events: GameEvents
  online?: OnlineSetup
}

export interface Game {
  update(dt: number): void
  render(ctx: CanvasRenderingContext2D): void
  destroy(): void
  serialize?(): unknown
  apply?(state: unknown): void
}

export interface ControlBinding {
  action: Action
  keys: string[]
  label: string
}

export interface GameModule {
  id: string
  title: string
  tagline: string
  categories: string[]
  accent: string
  players: 1 | 2
  modes: string[]
  controls: ControlBinding[]
  howToPlay: string[]
  width: number
  height: number
  load: () => Promise<{ create: (args: GameCreateArgs) => Game }>
  online?: 'friend' | 'ranked'
}

export type SfxName =
  | 'click'
  | 'eat'
  | 'die'
  | 'bounce'
  | 'wall'
  | 'clear'
  | 'line'
  | 'move'
  | 'merge'
  | 'win'
  | 'lose'
  | 'start'
  | 'countdown'

export interface AudioLike {
  play(name: SfxName, opts?: { pitch?: number }): void
  resume(): void
}
