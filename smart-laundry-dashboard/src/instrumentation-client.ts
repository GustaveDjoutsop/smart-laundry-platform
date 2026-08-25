// R7 — error tracking (browser runtime). Auto-loaded by Next.js; NEXT_PUBLIC_
// prefix is required because only NEXT_PUBLIC_-prefixed env vars are inlined
// into the client bundle at build time.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || 'development',
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  // Error capture only (per R7 scope), not full APM.
  tracesSampleRate: 0,
});
