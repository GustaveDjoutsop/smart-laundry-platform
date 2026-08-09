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

  async upsert({ botId, whatsappId, name, deliveryAddress, email }) {
    if (!botId || !whatsappId) throw new Error('CustomerProfileStore.upsert requires botId and whatsappId');

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
  }

  async get({ botId, whatsappId }) {
    const result = await this._getPool().query(
      `SELECT bot_id, whatsapp_id, name, delivery_address, email, created_at, last_active_at
       FROM customer_profile WHERE bot_id = $1 AND whatsapp_id = $2`,
      [botId, whatsappId]
    );
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
