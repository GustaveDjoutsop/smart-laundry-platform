/**
 * Structured Logger with PII Redaction
 * Uses Winston for production-ready logging with privacy protection
 *
 * Features:
 * - Structured JSON logging
 * - PII redaction (phone numbers, emails, tokens, passwords)
 * - Environment-aware log levels
 * - File logging in production
 * - Console logging in development
 */

const winston = require('winston');
const config = require('../config/env');

// PII patterns to redact
const PII_PATTERNS = {
    // Phone numbers (international format, e.g., 237677123456, +237677123456)
    phone: /(\+?\d{10,15})/g,

    // Email addresses
    email: /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi,

    // JWT tokens (3 parts separated by dots)
    jwt: /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/g,

    // Bearer tokens
    bearer: /Bearer\s+[a-zA-Z0-9_-]+/gi,

    // API keys (common patterns)
    apiKey: /(api[_-]?key|apikey|api-key)[\s:="']+([a-zA-Z0-9_-]{20,})/gi,

    // Passwords in common formats
    password: /(password|passwd|pwd)[\s:="']+([^\s"',}]+)/gi,

    // Credit card numbers (basic pattern)
    creditCard: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,

    // MongoDB ObjectIds (24 hex characters) - keep first 4 chars for debugging
    objectId: /\b[0-9a-f]{24}\b/gi
};

/**
 * Redact PII from a string or object
 * @param {any} data - Data to redact (string, object, array)
 * @returns {any} Redacted data
 */
function redactPII(data) {
    if (typeof data === 'string') {
        let redacted = data;

        // Redact phone numbers
        redacted = redacted.replace(PII_PATTERNS.phone, (match) => {
            // Keep country code visible for debugging (e.g., 237***456)
            if (match.length >= 8) {
                const prefix = match.slice(0, 3);
                const suffix = match.slice(-3);
                return `${prefix}***${suffix}`;
            }
            return '[PHONE_REDACTED]';
        });

        // Redact emails
        redacted = redacted.replace(PII_PATTERNS.email, (match) => {
            const [username, domain] = match.split('@');
            const visibleChars = Math.min(2, username.length);
            return `${username.slice(0, visibleChars)}***@${domain}`;
        });

        // Redact JWT tokens
        redacted = redacted.replace(PII_PATTERNS.jwt, '[JWT_REDACTED]');

        // Redact Bearer tokens
        redacted = redacted.replace(PII_PATTERNS.bearer, 'Bearer [TOKEN_REDACTED]');

        // Redact API keys
        redacted = redacted.replace(PII_PATTERNS.apiKey, (match, key, value) => {
            return `${key}: [API_KEY_REDACTED]`;
        });

        // Redact passwords
        redacted = redacted.replace(PII_PATTERNS.password, (match, key) => {
            return `${key}: [PASSWORD_REDACTED]`;
        });

        // Redact credit cards
        redacted = redacted.replace(PII_PATTERNS.creditCard, '[CARD_REDACTED]');

        // Redact MongoDB ObjectIds (keep first 4 chars)
        redacted = redacted.replace(PII_PATTERNS.objectId, (match) => {
            return `${match.slice(0, 4)}***`;
        });

        return redacted;
    }

    if (Array.isArray(data)) {
        return data.map(item => redactPII(item));
    }

    if (data && typeof data === 'object') {
        const redacted = {};
        for (const key in data) {
            // Redact sensitive field values completely
            if (/password|secret|token|key|auth/i.test(key)) {
                redacted[key] = '[REDACTED]';
            } else {
                redacted[key] = redactPII(data[key]);
            }
        }
        return redacted;
    }

    return data;
}

/**
 * Custom format that redacts PII from log messages
 */
const piiRedactionFormat = winston.format((info) => {
    // Redact message
    if (info.message) {
        info.message = redactPII(info.message);
    }

    // Redact metadata
    if (info.meta) {
        info.meta = redactPII(info.meta);
    }

    // Redact all other properties
    for (const key in info) {
        if (key !== 'level' && key !== 'timestamp' && key !== 'message' && key !== 'meta') {
            info[key] = redactPII(info[key]);
        }
    }

    return info;
});

/**
 * Determine log level based on environment
 */
function getLogLevel() {
    if (config.LOGGING && config.LOGGING.LEVEL) {
        return config.LOGGING.LEVEL;
    }

    if (config.IS_PRODUCTION) return 'info';
    if (config.IS_STAGE) return 'info';
    if (config.IS_TEST) return 'error'; // Less noise in tests
    return 'debug'; // Development
}

/**
 * Create Winston logger instance
 */
const logger = winston.createLogger({
    level: getLogLevel(),
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        piiRedactionFormat(),
        winston.format.json()
    ),
    defaultMeta: {
        service: 'laundry-backend',
        environment: config.NODE_ENV
    },
    transports: []
});

// Console transport (development, test, CICD)
if (config.IS_DEVELOPMENT || config.IS_TEST || config.IS_CICD) {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.printf(({ level, message, timestamp, ...meta }) => {
                let metaStr = '';
                const defaultMetaKeys = ['service', 'environment', 'level', 'message', 'timestamp', 'splat'];
                const hasNonDefaultMeta = Object.keys(meta).some(
                    (key) => !defaultMetaKeys.includes(key)
                );
                if (hasNonDefaultMeta) {
                    metaStr = ' ' + JSON.stringify(meta);
                }
                return `${timestamp} [${level}]: ${message}${metaStr}`;
            })
        )
    }));
}

// File transports (production, staging)
if (config.IS_PRODUCTION || config.IS_STAGE) {
    // Error log file
    logger.add(new winston.transports.File({
        filename: 'logs/error.log',
        level: 'error',
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }));

    // Combined log file
    logger.add(new winston.transports.File({
        filename: 'logs/combined.log',
        maxsize: 5242880, // 5MB
        maxFiles: 5
    }));

    // Console transport for production (JSON format for log aggregation)
    logger.add(new winston.transports.Console({
        format: winston.format.json()
    }));
}

/**
 * Wrapper functions for common log levels
 * These provide a cleaner API and ensure PII redaction
 */
const log = {
    error: (message, meta = {}) => logger.error(message, meta),
    warn: (message, meta = {}) => logger.warn(message, meta),
    info: (message, meta = {}) => logger.info(message, meta),
    debug: (message, meta = {}) => logger.debug(message, meta),
    verbose: (message, meta = {}) => logger.verbose(message, meta),

    // Convenience methods
    http: (message, meta = {}) => logger.info(message, { ...meta, type: 'http' }),
    db: (message, meta = {}) => logger.debug(message, { ...meta, type: 'database' }),
    mqtt: (message, meta = {}) => logger.debug(message, { ...meta, type: 'mqtt' }),
    payment: (message, meta = {}) => logger.info(message, { ...meta, type: 'payment' }),
    webhook: (message, meta = {}) => logger.info(message, { ...meta, type: 'webhook' })
};

module.exports = {
    logger,
    log,
    redactPII, // Export for testing
    getLogLevel // Export for testing
};
