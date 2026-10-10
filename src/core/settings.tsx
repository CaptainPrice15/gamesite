/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { GameSettings } from './types'
import { load, save } from './storage'
import { getAudio } from './audio'

const KEY = 'settings'

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export const DEFAULT_SETTINGS: GameSettings = {
  masterVolume: 0.8,
  musicVolume: 0.35,
  sfxVolume: 0.8,
  difficulty: 'normal',
  wrapWalls: false,
  leftHanded: false,
  reducedMotion: prefersReducedMotion(),
  showControls: true,
}

interface SettingsContextValue {
  settings: GameSettings
  update: (patch: Partial<GameSettings>) => void
  reset: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

function sanitise(raw: Partial<GameSettings>): GameSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(raw ?? {}) }
  const clamp = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback
  return {
    ...merged,
    masterVolume: clamp(merged.masterVolume, DEFAULT_SETTINGS.masterVolume),
    musicVolume: clamp(merged.musicVolume, DEFAULT_SETTINGS.musicVolume),
    sfxVolume: clamp(merged.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    difficulty:
      merged.difficulty === 'easy' || merged.difficulty === 'hard' ? merged.difficulty : 'normal',
  }
}

export function SettingsProvider({ children }: { children: ReactNode }): ReactNode {
  const [settings, setSettings] = useState<GameSettings>(() => sanitise(load(KEY, {})))

  const update = useCallback((patch: Partial<GameSettings>) => {
    setSettings((prev) => {
      const next = sanitise({ ...prev, ...patch })
      save(KEY, next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
    save(KEY, DEFAULT_SETTINGS)
  }, [])

  useEffect(() => {
    getAudio().setVolumes({
      master: settings.masterVolume,
      music: settings.musicVolume,
      sfx: settings.sfxVolume,
    })
  }, [settings.masterVolume, settings.musicVolume, settings.sfxVolume])

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', settings.reducedMotion)
  }, [settings.reducedMotion])

  const value = useMemo(() => ({ settings, update, reset }), [settings, update, reset])

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}
