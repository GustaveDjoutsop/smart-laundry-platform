const { getPool } = require('../db/pgClient');

// Accountability trail for erasure requests (Art. 5(2) DSGVO): you must be
// able to prove a deletion request was received and handled, independent of
// whether the underlying personal data still exists to prove it against.
class DeletionRequestLogStore {
  constructor({ pool } = {}) {
    this.pool = pool || null;
  }

  _getPool() {
    return this.pool || getPool();
  }

  async logRequested({ botId, whatsappId }) {
    const result = await this._getPool().query(
      `INSERT INTO deletion_request_log (bot_id, whatsapp_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING id`,
      [botId, whatsappId]
    );
    return result.rows[0].id;
  }

  async markCompleted(id) {
    await this._getPool().query(
      `UPDATE deletion_request_log SET status = 'completed', completed_at = now() WHERE id = $1`,
      [id]
    );
  }

  async markFailed(id) {
    await this._getPool().query(
      `UPDATE deletion_request_log SET status = 'failed', completed_at = now() WHERE id = $1`,
      [id]
    );
  }
}

module.exports = { DeletionRequestLogStore };
