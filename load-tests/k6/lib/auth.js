import http from 'k6/http';

/**
 * Fetches an Auth0 M2M access token via client_credentials.
 * Call from k6 setup() and pass the returned token to the default function.
 *
 * Required env vars (pass via k6 -e flag or Doppler):
 *   AUTH0_DOMAIN       e.g. dev-iuo6si32jobgnmod.eu.auth0.com
 *   AUTH0_CLIENT_ID    M2M client ID
 *   AUTH0_CLIENT_SECRET
 *   AUTH0_AUDIENCE     e.g. https://smartlaundry.api
 */
export function getM2MToken() {
  const domain   = __ENV.AUTH0_DOMAIN;
  const clientId = __ENV.AUTH0_CLIENT_ID;
  const secret   = __ENV.AUTH0_CLIENT_SECRET;
  const audience = __ENV.AUTH0_AUDIENCE || 'https://smartlaundry.api';

  if (!domain || !clientId || !secret) {
    throw new Error('AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET are required');
  }

  const res = http.post(
    `https://${domain}/oauth/token`,
    JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: secret, audience }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (res.status !== 200) {
    throw new Error(`Auth0 token request failed: ${res.status} ${res.body}`);
  }

  return JSON.parse(res.body).access_token;
}
