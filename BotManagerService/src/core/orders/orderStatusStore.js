const { getPool } = require('../db/pgClient');

// Fulfilment status (CONFIRMED -> SHIPPED -> DELIVERED) for AfroMarket
// orders - see migrations/005_orders_table.sql for why this isn't a column
// on invoice_record (that table is write-once by DB trigger) and why it
// carries no personal data (ADR-008: that lives in customer_profile, which
// erasure can delete).
//
// order_number is invoice_record.invoice_number, and the FK to it means a
// status row can only exist for an invoice that was actually written.
class OrderStatusStore {
  constructor({ pool } = {}) {
    this.pool = pool || null;
  }

  _getPool() {
    return this.pool || getPool();
  }

  // Postgres 42P01 is undefined_table - the one actionable failure mode
  // here (migration 005 not applied on this environment yet), rethrown
  // with the filename so an operator sees what to run. Everything else
  // (FK violation, connection refused) passes through unchanged.
  //
  // code/cause are carried over rather than dropped: callers added later
  // (the planned admin shipped/delivered intercept) still need to tell
  // 42P01 from a 23503 FK violation, and a bare Error would make the one
  // branch that adds context the only unclassifiable one.
  _rethrowWithMigrationHint(err) {
    if (err && err.code === '42P01' && /orders/i.test(err.message || '')) {
      const hinted = new Error(`${err.message} - has migrations/005_orders_table.sql been applied to this database yet?`);
      hinted.code = err.code;
      hinted.cause = err;
      throw hinted;
    }
    throw err;
  }

  // ON CONFLICT DO NOTHING, not an upsert: a redelivered payment webhook
  // for an order that is already SHIPPED must never be reset to CONFIRMED.
  async insertConfirmed({ orderNumber }) {
    if (!orderNumber) throw new Error('OrderStatusStore.insertConfirmed requires orderNumber');

    try {
      await this._getPool().query(
        `INSERT INTO orders (order_number, status, confirmed_at)
         VALUES ($1, 'CONFIRMED', now())
         ON CONFLICT (order_number) DO NOTHING`,
        [orderNumber]
      );
    } catch (err) {
      this._rethrowWithMigrationHint(err);
    }
  }

  async get({ orderNumber }) {
    let result;
    try {
      result = await this._getPool().query(
        'SELECT order_number, status, confirmed_at, shipped_at, delivered_at FROM orders WHERE order_number = $1',
        [orderNumber]
      );
    } catch (err) {
      this._rethrowWithMigrationHint(err);
    }

    return result.rows[0] || null;
  }
}

module.exports = { OrderStatusStore };
