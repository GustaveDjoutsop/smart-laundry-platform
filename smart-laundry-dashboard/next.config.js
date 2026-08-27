const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // R10 — CDN/asset optimization. Two of the roadmap's targets need nothing here:
  //   - `/_next/static/*` (everything Next.js itself emits) already gets
  //     `Cache-Control: public, max-age=31536000, immutable` automatically, and Next
  //     explicitly refuses to let next.config.js override it — those files are
  //     content-hashed and safe to cache forever by construction.
  //   - Dynamically-rendered pages already default to `private, no-store`.
  // The `no-store` half of item 2 (`/admin/*` API responses) has no target here either:
  // this app has no `/admin/*` routes of its own (no app/api at all) — it's implemented
  // on reporting-bff's actual `/api/admin/**`, see CacheHeaderFilterConfig there.
  //
  // What *is* configured below is image optimization (the other half of item 2) —
  // though note the app currently has exactly one <img>, MachineQRCodeModal's
  // client-generated QR code `data:` URL. next/image explicitly excludes `data:` URLs
  // from its optimization pipeline (nothing to fetch/resize/cache), so converting it
  // would add complexity for zero benefit; left as a plain <img> deliberately. This
  // config is forward-looking for the next real (remote/static) image the app adds.
  images: {
    formats: ['image/avif', 'image/webp'],
  },
}

// R7 — uploads source maps at build time (only when SENTRY_AUTH_TOKEN is set,
// e.g. in CI) so Sentry stack traces resolve to real TSX, not minified
// bundles. Silently a no-op locally where the token is absent.
module.exports = withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // Route Sentry's client requests through our own origin so ad-blockers
  // don't drop them.
  tunnelRoute: '/sentry-tunnel',
})
