const { redact } = require('./redact');

const logger = {
  info: (msg, meta) => console.log('[INFO]', redact(msg), meta ? redact(meta) : ''),
  warn: (msg, meta) => console.warn('[WARN]', redact(msg), meta ? redact(meta) : ''),
  error: (msg, meta) => console.error('[ERROR]', redact(msg), meta ? redact(meta) : '')
};

module.exports = { logger, redact };
