import { Auth0Client } from '@auth0/nextjs-auth0/server';

const domain =
  process.env.AUTH0_DOMAIN ||
  process.env.AUTH0_ISSUER_BASE_URL?.replace(/^https?:\/\//, '') ||
  undefined;

const appBaseUrl =
  process.env.APP_BASE_URL || process.env.AUTH0_BASE_URL || undefined;

const ROLE_CLAIM = 'https://smartlaundry.api/roles';

export const auth0 = new Auth0Client({
  ...(domain && { domain }),
  ...(appBaseUrl && { appBaseUrl }),
  signInReturnToPath: '/dashboard',
  authorizationParameters: {
    audience: process.env.AUTH0_AUDIENCE,
    scope: 'openid profile email',
  },
  // v4: session.user is built from /userinfo (standard OIDC claims only).
  // Custom claims injected by Auth0 Actions live in the ID token, not /userinfo.
  // Copy them into the session here so useUser() and getSession() can see them.
  async beforeSessionSaved(session, idToken) {
    if (!idToken) return session;
    try {
      const [, payload] = idToken.split('.');
      const padded = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = atob(padded);
      const claims = JSON.parse(json) as Record<string, unknown>;
      return {
        ...session,
        user: {
          ...session.user,
          [ROLE_CLAIM]: claims[ROLE_CLAIM] ?? [],
        },
      };
    } catch {
      return session;
    }
  },
});
