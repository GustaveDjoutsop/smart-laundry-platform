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
  constructor({ customerProfileStore, deletionRequestLogStore }) {
    if (!customerProfileStore) throw new Error('DeletionRequestService requires customerProfileStore');
    if (!deletionRequestLogStore) throw new Error('DeletionRequestService requires deletionRequestLogStore');

    this.customerProfileStore = customerProfileStore;
    this.deletionRequestLogStore = deletionRequestLogStore;
  }

  async execute({ botId, whatsappId }) {
    if (!botId || !whatsappId) throw new Error('DeletionRequestService.execute requires botId and whatsappId');

    const logId = await this.deletionRequestLogStore.logRequested({ botId, whatsappId });

    try {
      await this.customerProfileStore.delete({ botId, whatsappId });
      await redisManager.del(`conv:${botId}:${whatsappId}`);

      await this.deletionRequestLogStore.markCompleted(logId);
      logger.info(`Deletion request completed for ${botId}:${whatsappId}`);
    } catch (err) {
      await this.deletionRequestLogStore.markFailed(logId);
      logger.error(
        `Deletion request failed for ${botId}:${whatsappId}`,
        err && err.message ? err.message : String(err)
      );
      throw err;
    }
  }
}

module.exports = { DeletionRequestService };
