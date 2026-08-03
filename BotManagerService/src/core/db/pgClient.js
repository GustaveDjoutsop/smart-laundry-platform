const { logger } = require('../../utils/logger');
const { getAppConfig } = require('../appConfig');

let Pool;
try {
  // Optional dependency at runtime, same pattern as redisManager's `redis` require.
  // eslint-disable-next-line global-require
  ({ Pool } = require('pg'));
} catch (_err) {
  Pool = null;
}

let pool = null;

// Lazily creates the shared connection pool on first use rather than at
// require-time, so tests and code paths that never touch Postgres (most of
// the app, today) don't pay for a connection attempt.
function getPool() {
  if (pool) return pool;

  const config = getAppConfig();
  if (!config.database.url) {
    throw new Error('DATABASE_URL not set: cannot use Postgres-backed stores');
  }
  if (!Pool) {
    throw new Error('pg dependency not available: cannot use Postgres-backed stores');
  }

  // No explicit `ssl` option: Supabase connection strings carry sslmode in
  // the URL itself. Verify this actually works against the real pooled
  // connection string once DATABASE_URL is wired up in Railway - not
  // exercised yet, nothing points at Postgres in any deployed environment.
  pool = new Pool({ connectionString: config.database.url });
  pool.on('error', (err) => {
    logger.error('Postgres pool error', err && err.message ? err.message : String(err));
  });

  return pool;
}

module.exports = { getPool };
