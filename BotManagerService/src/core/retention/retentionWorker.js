const { logger } = require('../../utils/logger');

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily; ADR-008 only requires "monthly is fine"

// Enforces the other half of the retention promise: a scheduled sweep that
// actually deletes invoice_record rows once they pass their 10-year
// retain_until, and customer_profile rows inactive for 3+ years. Talks to
// Postgres directly rather than through InvoiceRecordStore, which
// deliberately exposes no delete() - see ADR-008.
class RetentionWorker {
  constructor({ pool, intervalMs, logger: injectedLogger } = {}) {
    if (!pool) throw new Error('RetentionWorker requires a pool');
    this.pool = pool;
    this.intervalMs = typeof intervalMs === 'number' ? intervalMs : DEFAULT_INTERVAL_MS;
    this.logger = injectedLogger || logger;
    this.timer = null;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.runOnce().catch((err) => {
        this.logger.error('RetentionWorker sweep failed', err && err.message ? err.message : String(err));
      });
    }, this.intervalMs);
    this.timer.unref?.();

    // Run once at startup too, rather than waiting a full interval for the first sweep.
    this.runOnce().catch((err) => {
      this.logger.error('RetentionWorker initial sweep failed', err && err.message ? err.message : String(err));
    });
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce() {
    const expiredInvoices = await this.pool.query(
      'DELETE FROM invoice_record WHERE retain_until < now() RETURNING id'
    );
    if (expiredInvoices.rowCount) {
      this.logger.info(`RetentionWorker purged ${expiredInvoices.rowCount} expired invoice_record row(s)`);
    }

    const inactiveProfiles = await this.pool.query(
      "DELETE FROM customer_profile WHERE last_active_at < now() - interval '3 years' RETURNING bot_id, whatsapp_id"
    );
    if (inactiveProfiles.rowCount) {
      this.logger.info(`RetentionWorker purged ${inactiveProfiles.rowCount} inactive customer_profile row(s)`);
    }

    return {
      invoicesPurged: expiredInvoices.rowCount,
      profilesPurged: inactiveProfiles.rowCount
    };
  }
}

module.exports = { RetentionWorker };
