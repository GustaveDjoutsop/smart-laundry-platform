const { getPool } = require('../db/pgClient');

// CRUD for customer_profile - the only store the erasure flow touches for
// personal data. See ADR-008 (data retention & erasure) for why this is
// split from invoice_record: profile rows are freely deletable, invoices
// aren't.
class CustomerProfileStore {
  constructor({ pool } = {}) {
    this.pool = pool || null;
  }

  _getPool() {
    return this.pool || getPool();
  }

  // Postgres error code 42703 is undefined_column - the one failure mode
  // that's actually actionable here (a migration not applied yet on this
  // environment). Rethrown with the migration filename attached so an
  // operator sees exactly what to run instead of a bare "column X does not
  // exist" with no context; every other error (connection refused, bad
  // params, etc.) passes through unchanged.
  _rethrowWithMigrationHint(err) {
    if (err && err.code === '42703') {
      if (/email/i.test(err.message || '')) {
        throw new Error(
          `${err.message} - has migrations/003_add_customer_profile_email.sql been applied to this database yet?`
        );
      }
      if (/customer_id/i.test(err.message || '')) {
        throw new Error(
          `${err.message} - has migrations/004_add_customer_identity_link.sql been applied to this database yet?`
        );
      }
    }
    throw err;
  }

  // customerId is the canonical id from IdentityResolver (see
  // afromarket-identity-linkage-design.md) - nullable and additive, same
  // pattern as email in migration 003. COALESCE keeps whatever's already on
  // file when a caller doesn't have a resolved id yet (e.g. identity
  // resolution failed but the profile write shouldn't be blocked by that -
  // see AfroMarketBot._recordOrder), never clears a previously-linked id.
  async upsert({ botId, whatsappId, name, deliveryAddress, email, customerId }) {
    if (!botId || !whatsappId) throw new Error('CustomerProfileStore.upsert requires botId and whatsappId');

    try {
      await this._getPool().query(
        `INSERT INTO customer_profile (bot_id, whatsapp_id, name, delivery_address, email, customer_id, created_at, last_active_at)
         VALUES ($1, $2, $3, $4, $5, $6, now(), now())
         ON CONFLICT (bot_id, whatsapp_id) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, customer_profile.name),
           delivery_address = COALESCE(EXCLUDED.delivery_address, customer_profile.delivery_address),
           email = COALESCE(EXCLUDED.email, customer_profile.email),
           customer_id = COALESCE(EXCLUDED.customer_id, customer_profile.customer_id),
           last_active_at = now()`,
        [botId, whatsappId, name || null, deliveryAddress || null, email || null, customerId || null]
      );
    } catch (err) {
      this._rethrowWithMigrationHint(err);
    }
  }

  async get({ botId, whatsappId }) {
    let result;
    try {
      result = await this._getPool().query(
        `SELECT bot_id, whatsapp_id, name, delivery_address, email, customer_id, created_at, last_active_at
         FROM customer_profile WHERE bot_id = $1 AND whatsapp_id = $2`,
        [botId, whatsappId]
      );
    } catch (err) {
      this._rethrowWithMigrationHint(err);
    }
    return result.rows[0] || null;
  }

  async delete({ botId, whatsappId }) {
    await this._getPool().query(
      'DELETE FROM customer_profile WHERE bot_id = $1 AND whatsapp_id = $2',
      [botId, whatsappId]
    );
  }
}

module.exports = { CustomerProfileStore };
