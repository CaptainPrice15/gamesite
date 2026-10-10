export type ThemePref = 'dark' | 'light' | 'system'
export type ResolvedTheme = 'dark' | 'light'

const KEY = 'theme'
const listeners = new Set<(t: ResolvedTheme) => void>()

function media(): MediaQueryList | null {
  return typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: light)') : null
}

export function systemTheme(): ResolvedTheme {
  return media()?.matches ? 'light' : 'dark'
}

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem('arcade.' + KEY)
    if (v === 'dark' || v === 'light' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

export function resolveTheme(): ResolvedTheme {
  const pref = getThemePref()
  return pref === 'system' ? systemTheme() : pref
}

function apply(): ResolvedTheme {
  const t = resolveTheme()
  document.documentElement.dataset.theme = t
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', t === 'dark' ? '#0b0f17' : '#f6f8fc')
  listeners.forEach((l) => l(t))
  return t
}

export function setThemePref(pref: ThemePref): ResolvedTheme {
  try {
    if (pref === 'system') localStorage.removeItem('arcade.' + KEY)
    else localStorage.setItem('arcade.' + KEY, pref)
  } catch {
    /* ignore */
  }
  return apply()
}

export function toggleTheme(): ResolvedTheme {
  return setThemePref(resolveTheme() === 'dark' ? 'light' : 'dark')
}

export function subscribeTheme(fn: (t: ResolvedTheme) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let initialised = false
/** Call once at boot; reacts to OS theme changes while pref = system. */
export function initTheme(): void {
  if (initialised || typeof window === 'undefined') return
  initialised = true
  apply()
  media()?.addEventListener('change', () => {
    if (getThemePref() === 'system') apply()
  })
}
