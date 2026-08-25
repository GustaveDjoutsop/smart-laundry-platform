const { withSentryConfig } = require('@sentry/nextjs')

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
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
