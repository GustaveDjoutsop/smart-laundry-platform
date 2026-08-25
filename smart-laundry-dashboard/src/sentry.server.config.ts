// R7 — error tracking (server runtime: Node.js request handlers, Server
// Components, Route Handlers). Loaded from src/instrumentation.ts.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || 'development',
  // Falls back to detecting the current commit automatically when unset — see
  // withSentryConfig's release.name option in next.config.js. Set explicitly
  // in CI so this matches the client bundle's release.
  release: process.env.SENTRY_RELEASE,
  // Error capture only (per R7 scope), not full APM — keeps this inside
  // Sentry's free tier alongside the three backend services.
  tracesSampleRate: 0,
});
