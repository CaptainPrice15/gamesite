interface Umami {
  track(name: string, data?: Record<string, unknown>): void
}

let analytics: Umami | null = null

export function initAnalytics(): void {
  if (!import.meta.env.PROD) return
  const src = import.meta.env.VITE_UMAMI_SRC
  const websiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID
  if (!src || !websiteId || src.includes('placeholder')) return

  const script = document.createElement('script')
  script.defer = true
  script.src = src
  script.setAttribute('data-website-id', websiteId)
  document.head.appendChild(script)

  analytics = {
    track: (name, data) => {
      const w = window as unknown as { umami?: { track: (n: string, d?: unknown) => void } }
      w.umami?.track(name, data)
    },
  }
}

export function trackEvent(name: string, data?: Record<string, unknown>): void {
  analytics?.track(name, data)
}
