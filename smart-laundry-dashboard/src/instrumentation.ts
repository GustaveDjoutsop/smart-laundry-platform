// R7 — registers the Sentry server/edge SDKs per the Next.js instrumentation
// hook. Client-side init lives in instrumentation-client.ts (loaded by
// Next.js automatically, not through this file).
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }

  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
