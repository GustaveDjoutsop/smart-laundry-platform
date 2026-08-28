// R7 — error tracking (edge runtime: middleware). Loaded from
// src/instrumentation.ts.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT || 'development',
  release: process.env.SENTRY_RELEASE,
  // Error capture only (per R7 scope), not full APM.
  tracesSampleRate: 0,
});
