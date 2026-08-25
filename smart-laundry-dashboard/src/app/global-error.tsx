'use client';

import { useEffect } from 'react';
import * as Sentry from '@sentry/nextjs';

// R7 — catches errors that crash the root layout itself, the one place a
// normal error.tsx boundary can't reach. Replaces the whole document, so it
// needs its own <html>/<body>.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <h2>Something went wrong.</h2>
        <button onClick={() => reset()}>Try again</button>
      </body>
    </html>
  );
}
