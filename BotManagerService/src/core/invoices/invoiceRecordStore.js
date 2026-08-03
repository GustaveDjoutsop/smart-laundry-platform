const { getPool } = require('../db/pgClient');

// Append-only store for invoice_record. Deliberately exposes no update() or
// delete() - retention (§ 147 AO / § 257 HGB, 10 years) is enforced by the
// `retain_until` column plus a DB trigger that rejects UPDATE/DELETE before
// that date. The only legitimate deletion path is the retention job
// (src/core/retention/retentionWorker.js), which talks to Postgres directly
// rather than through this class - see ADR-008.
//
// Invoice rows are snapshots: buyer name/address/phone are copied in at
// insert time, not looked up live from customer_profile. Deleting a
// customer's profile later must never touch historical invoices.
class InvoiceRecordStore {
  constructor({ pool } = {}) {
    this.pool = pool || null;
  }

  _getPool() {
    return this.pool || getPool();
  }

  async insert({
    botId,
    transactionId,
    provider,
    buyerName,
    buyerAddress,
    buyerPhone,
    lineItems,
    amount,
    currency,
    taxStatus,
    paymentReference
  }) {
    if (!botId || !transactionId || !provider) {
      throw new Error('InvoiceRecordStore.insert requires botId, transactionId and provider');
    }
    if (amount == null || !currency) {
      throw new Error('InvoiceRecordStore.insert requires amount and currency');
    }

    const invoiceNumber = `${String(botId).toUpperCase()}-${transactionId}`;

    const result = await this._getPool().query(
      `INSERT INTO invoice_record (
         invoice_number, bot_id, transaction_id, provider,
         buyer_name, buyer_address, buyer_phone,
         line_items, amount, currency, tax_status, payment_reference,
         retain_until
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now() + interval '10 years')
       RETURNING id, invoice_number, created_at, retain_until`,
      [
        invoiceNumber,
        botId,
        transactionId,
        provider,
        buyerName || null,
        buyerAddress || null,
        buyerPhone || null,
        JSON.stringify(lineItems || []),
        amount,
        currency,
        taxStatus || null,
        paymentReference || null
      ]
    );

    return result.rows[0];
  }

  async get({ botId, transactionId }) {
    const result = await this._getPool().query(
      'SELECT * FROM invoice_record WHERE bot_id = $1 AND transaction_id = $2',
      [botId, transactionId]
    );
    return result.rows[0] || null;
  }
}

module.exports = { InvoiceRecordStore };
