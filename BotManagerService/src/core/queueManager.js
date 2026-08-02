const { logger } = require('../utils/logger');

class QueueManager {
  constructor({ maxSize } = {}) {
    this.maxSize = typeof maxSize === 'number' ? maxSize : 500;
    this.queue = [];
    this.processing = false;
    this.processor = null;
  }

  setProcessor(fn) {
    this.processor = fn;
  }

  enqueue(job) {
    if (!this.processor) {
      throw new Error('QueueManager processor not set');
    }

    if (this.queue.length >= this.maxSize) {
      logger.warn('Queue full: dropping job');
      return false;
    }

    this.queue.push(job);
    this._drain();
    return true;
  }

  async _drain() {
    if (this.processing) return;
    this.processing = true;

    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        try {
          // eslint-disable-next-line no-await-in-loop
          await this.processor(job);
        } catch (err) {
          logger.error('Queue job failed', err && err.message ? err.message : String(err));
        }
      }
    } finally {
      this.processing = false;
    }
  }
}

module.exports = { QueueManager };
