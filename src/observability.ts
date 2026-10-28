import type { ErrorEvent } from '@sentry/react'
/** Hosted telemetry never includes report content, identifiers or share URLs. */
export function publicPage(url: string): string | null {
  const parsed = new URL(url)
  return ['/', '/explore', '/login'].includes(parsed.pathname) && !parsed.search && !parsed.hash ? parsed.origin + parsed.pathname : null
}
export async function startObservability() {
  if (!import.meta.env.PROD || location.hostname !== 'openeval.howaiworks.io') return
  if (publicPage(location.href) && (!document.referrer || publicPage(document.referrer))) {
    const { inject } = await import('@vercel/analytics')
    inject({ beforeSend: event => {
      const url = publicPage(event.url)
      return url ? { ...event, url } : null
    } })
  }
  if (!import.meta.env.VITE_SENTRY_DSN) return
  const Sentry = await import('@sentry/react')
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN, environment: 'production',
    defaultIntegrations: false,
    integrations: [Sentry.globalHandlersIntegration(), Sentry.dedupeIntegration()],
    beforeSend: event => sanitizeError(event, location.origin),
  })
}

export function captureApplicationError(error: unknown) {
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN && location.hostname === 'openeval.howaiworks.io') {
    void import('@sentry/react').then(Sentry => Sentry.captureException(error)).catch(() => {})
  }
}

/** Keep code locations, never exception messages or application state. */
export function sanitizeError(event: ErrorEvent, origin: string): ErrorEvent {
  return {
    type: event.type, event_id: event.event_id, timestamp: event.timestamp, platform: event.platform,
    environment: event.environment, level: event.level,
    exception: { values: event.exception?.values?.map(value => ({
      type: ['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'EvalError', 'AggregateError'].includes(value.type ?? '') ? value.type : 'Error', value: 'OpenEval application error',
      stacktrace: { frames: value.stacktrace?.frames?.filter(frame => frame.filename?.startsWith(origin + '/assets/')).map(frame => ({
        filename: frame.filename!.split(/[?#]/)[0], lineno: frame.lineno, colno: frame.colno,
      })) },
    })) },
  }
}
