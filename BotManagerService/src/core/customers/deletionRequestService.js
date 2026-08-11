const { redisManager } = require('../redisManager');
const { logger } = require('../../utils/logger');

// Orchestrates an Art. 17 DSGVO erasure request end to end. See ADR-008.
//
// Only conv:<botId>:<whatsappId> is deleted from Redis - it's the one key
// directly addressable by phone number. payment:<botId>:<transactionId>
// records aren't indexed by phone (no reverse lookup exists), so they can't
// be safely targeted here without risking another customer's in-flight
// payment; they already carry a 24h TTL and expire on their own regardless.
// invoice_record is never touched - that's the entire point of the split.
class DeletionRequestService {
  constructor({ customerProfileStore, deletionRequestLogStore, customerIdentityLinkStore }) {
    if (!customerProfileStore) throw new Error('DeletionRequestService requires customerProfileStore');
    if (!deletionRequestLogStore) throw new Error('DeletionRequestService requires deletionRequestLogStore');

    this.customerProfileStore = customerProfileStore;
    this.deletionRequestLogStore = deletionRequestLogStore;
    // Optional - see afromarket-identity-linkage-design.md (ADR-008 open
    // question #4). Without it, erasure covers only the identifier the
    // request arrived on, same as before linkage existed.
    this.customerIdentityLinkStore = customerIdentityLinkStore || null;
  }

  async execute({ botId, whatsappId }) {
    if (!botId || !whatsappId) throw new Error('DeletionRequestService.execute requires botId and whatsappId');

    const logId = await this.deletionRequestLogStore.logRequested({ botId, whatsappId });

    try {
      const identifiersToErase = await this._resolveAllLinkedIdentifiers(whatsappId);

      for (const identifierValue of identifiersToErase) {
        // eslint-disable-next-line no-await-in-loop
        await this.customerProfileStore.delete({ botId, whatsappId: identifierValue });
        // eslint-disable-next-line no-await-in-loop
        await redisManager.del(`conv:${botId}:${identifierValue}`);
      }

      await this.deletionRequestLogStore.markCompleted(logId);
      logger.info(
        `Deletion request completed for ${botId}:${whatsappId}` +
          (identifiersToErase.length > 1 ? ` (linked identifiers: ${identifiersToErase.join(', ')})` : '')
      );
    } catch (err) {
      await this.deletionRequestLogStore.markFailed(logId);
      logger.error(
        `Deletion request failed for ${botId}:${whatsappId}`,
        err && err.message ? err.message : String(err)
      );
      throw err;
    }
  }

  // whatsappId may be a phone or a BSUID - the caller doesn't tell us which,
  // so both link-store lookups are tried. Returns just [whatsappId] when no
  // linkage store is configured or this identifier has no recorded link,
  // matching the original single-identifier behavior exactly.
  async _resolveAllLinkedIdentifiers(whatsappId) {
    if (!this.customerIdentityLinkStore) return [whatsappId];

    const customerId =
      (await this.customerIdentityLinkStore.findByIdentifier({ identifierType: 'phone', identifierValue: whatsappId })) ||
      (await this.customerIdentityLinkStore.findByIdentifier({ identifierType: 'bsuid', identifierValue: whatsappId }));

    if (!customerId) return [whatsappId];

    const linked = await this.customerIdentityLinkStore.findIdentifiersByCustomerId({ customerId });
    const values = linked.map((row) => row.identifier_value);

    return values.includes(whatsappId) ? values : [...values, whatsappId];
  }
}

module.exports = { DeletionRequestService };
