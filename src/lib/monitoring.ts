let active = false

export async function initMonitoring(): Promise<void> {
  if (!import.meta.env.PROD) return
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn || dsn.includes('placeholder')) return
  try {
    const Sentry = await import('@sentry/react')
    Sentry.init({
      dsn,
      environment: 'production',
      tracesSampleRate: 0.1,
      ignoreErrors: ['ResizeObserver loop'],
    })
    active = true
  } catch {
    active = false
  }
}

export function captureError(error: unknown, context?: Record<string, unknown>): void {
  if (!active) return
  void import('@sentry/react')
    .then((Sentry) => {
      Sentry.captureException(error, context ? { extra: context } : undefined)
    })
    .catch(() => undefined)
}
