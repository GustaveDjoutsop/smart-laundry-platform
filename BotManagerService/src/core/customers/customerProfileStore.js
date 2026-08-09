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
  // that's actually actionable here (migrations/003_add_customer_profile_email.sql
  // not applied yet on this environment). Rethrown with the migration
  // filename attached so an operator sees exactly what to run instead of a
  // bare "column email does not exist" with no context; every other error
  // (connection refused, bad params, etc.) passes through unchanged.
  _rethrowWithMigrationHint(err) {
    if (err && err.code === '42703' && /email/i.test(err.message || '')) {
      throw new Error(
        `${err.message} - has migrations/003_add_customer_profile_email.sql been applied to this database yet?`
      );
    }
    throw err;
  }

  async upsert({ botId, whatsappId, name, deliveryAddress, email }) {
    if (!botId || !whatsappId) throw new Error('CustomerProfileStore.upsert requires botId and whatsappId');

    try {
      await this._getPool().query(
        `INSERT INTO customer_profile (bot_id, whatsapp_id, name, delivery_address, email, created_at, last_active_at)
         VALUES ($1, $2, $3, $4, $5, now(), now())
         ON CONFLICT (bot_id, whatsapp_id) DO UPDATE SET
           name = COALESCE(EXCLUDED.name, customer_profile.name),
           delivery_address = COALESCE(EXCLUDED.delivery_address, customer_profile.delivery_address),
           email = COALESCE(EXCLUDED.email, customer_profile.email),
           last_active_at = now()`,
        [botId, whatsappId, name || null, deliveryAddress || null, email || null]
      );
    } catch (err) {
      this._rethrowWithMigrationHint(err);
    }
  }

  async get({ botId, whatsappId }) {
    let result;
    try {
      result = await this._getPool().query(
        `SELECT bot_id, whatsapp_id, name, delivery_address, email, created_at, last_active_at
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
