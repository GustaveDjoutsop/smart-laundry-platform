const crypto = require('crypto');
const { getPool } = require('../db/pgClient');

// CRUD for customer_identity_link - see afromarket-identity-linkage-design.md
// and migrations/004_add_customer_identity_link.sql. IdentityResolver is the
// only intended caller; this store has no opinion on when linking is safe,
// it just persists whatever link the caller decided on.
class CustomerIdentityLinkStore {
  constructor({ pool } = {}) {
    this.pool = pool || null;
  }

  _getPool() {
    return this.pool || getPool();
  }

  async findByIdentifier({ identifierType, identifierValue }) {
    if (!identifierType || !identifierValue) return null;

    const result = await this._getPool().query(
      `SELECT customer_id FROM customer_identity_link WHERE identifier_type = $1 AND identifier_value = $2`,
      [identifierType, identifierValue]
    );

    return result.rows[0] ? result.rows[0].customer_id : null;
  }

  async findIdentifiersByCustomerId({ customerId }) {
    if (!customerId) return [];

    const result = await this._getPool().query(
      `SELECT identifier_type, identifier_value FROM customer_identity_link WHERE customer_id = $1`,
      [customerId]
    );

    return result.rows;
  }

  // Atomic upsert-and-return: identifier_type+identifier_value is unique, so
  // a concurrent INSERT for the same identifier (e.g. WhatsApp's
  // at-least-once webhook redelivery racing two resolve() calls for the
  // same brand-new customer) hits ON CONFLICT instead of a second row.
  // DO UPDATE with a self-referencing no-op set (rather than DO NOTHING) is
  // required here specifically so RETURNING still fires on a conflict -
  // that's what lets the caller learn "someone else's customer_id already
  // won this identifier" instead of wrongly trusting its own locally
  // generated one. An identifier already linked to a *different* customer_id
  // is still left exactly as-is (never reassigned) - merging two canonical
  // customers is the manual_admin follow-up the design doc explicitly
  // defers, not something this store attempts automatically.
  async link({ customerId, identifierType, identifierValue, linkMethod }) {
    if (!customerId || !identifierType || !identifierValue || !linkMethod) {
      throw new Error('CustomerIdentityLinkStore.link requires customerId, identifierType, identifierValue, linkMethod');
    }

    const result = await this._getPool().query(
      `INSERT INTO customer_identity_link (id, customer_id, identifier_type, identifier_value, link_method, linked_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (identifier_type, identifier_value)
       DO UPDATE SET identifier_type = customer_identity_link.identifier_type
       RETURNING customer_id`,
      [crypto.randomUUID(), customerId, identifierType, identifierValue, linkMethod]
    );

    return result.rows[0].customer_id;
  }
}

module.exports = { CustomerIdentityLinkStore };
