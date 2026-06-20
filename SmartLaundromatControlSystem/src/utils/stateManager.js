/**
 * Session State Manager
 * Supports both Redis (production/staging) and in-memory (development) storage
 *
 * Redis is used for:
 * - Persistent sessions across server restarts
 * - Horizontal scaling (multiple server instances)
 * - Automatic session expiration (24 hours)
 *
 * In-memory fallback is used when:
 * - REDIS_URL is not configured (local development)
 * - Redis connection fails (with TTL-based cleanup to prevent memory leaks)
 *
 * Memory Leak Prevention:
 * - In-memory sessions have TTL (24 hours, same as Redis)
 * - Periodic cleanup runs every hour to remove expired sessions
 * - Cleanup starts automatically when using in-memory storage
 */

const Redis = require('ioredis');
const { log } = require('./logger');

// Session configuration
const SESSION_TTL = 24 * 60 * 60; // 24 hours in seconds
const SESSION_TTL_MS = SESSION_TTL * 1000; // TTL in milliseconds
const SESSION_PREFIX = 'whatsapp:session:'; // Key prefix for Redis
const CLEANUP_INTERVAL = 60 * 60 * 1000; // Run cleanup every hour (in milliseconds)

// In-memory fallback for local development
// Structure: { phone: { data: sessionData, expiresAt: timestamp } }
const memorySessions = {};

// Redis client instance
let redisClient = null;
let useRedis = false;

// Cleanup interval timer
let cleanupTimer = null;

/**
 * Clean up expired in-memory sessions
 * Runs periodically to prevent memory leaks when using in-memory fallback
 */
function cleanupExpiredSessions() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const phone in memorySessions) {
        if (memorySessions[phone].expiresAt < now) {
            delete memorySessions[phone];
            cleanedCount++;
        }
    }

    if (cleanedCount > 0) {
        log.info('Cleaned up expired in-memory sessions', { count: cleanedCount });
    }
}

/**
 * Start periodic cleanup of expired in-memory sessions
 * Guards against starting multiple timers
 */
function startCleanupTimer() {
    // Skip timers during Jest runs to avoid open handle warnings
    if (process.env.JEST_WORKER_ID) {
        return;
    }
    // Guard: don't start multiple timers
    if (cleanupTimer) {
        return; // Timer already running
    }

    // Run cleanup immediately
    cleanupExpiredSessions();

    // Schedule periodic cleanup
    cleanupTimer = setInterval(cleanupExpiredSessions, CLEANUP_INTERVAL);

    log.info('In-memory session cleanup scheduled', {
        intervalMinutes: CLEANUP_INTERVAL / 1000 / 60
    });
}

/**
 * Initialize Redis client if REDIS_URL is configured
 */
function initRedis() {
    const redisUrl = process.env.REDIS_URL;

    if (!redisUrl) {
        log.info('No REDIS_URL configured - using in-memory session storage');
        useRedis = false;
        startCleanupTimer(); // Start cleanup for in-memory mode
        return;
    }

    try {
        redisClient = new Redis(redisUrl, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
            reconnectOnError: (err) => {
                const message = err?.message || '';

                // For ECONNREFUSED (Redis server down), don't reconnect
                // Let the application fall back to in-memory storage instead of creating connection storms
                // The retryStrategy will handle initial connection retries
                if (message.includes('ECONNREFUSED')) {
                    return false;
                }

                // For transient errors that may be quickly resolved, reconnect immediately
                // READONLY: Redis instance is in read-only mode (e.g., during failover)
                // ETIMEDOUT: Network timeout, may be a temporary network issue
                // Return true to reconnect; retryStrategy controls the delay
                const reconnectErrors = ['READONLY', 'ETIMEDOUT'];
                return reconnectErrors.some(targetError => message.includes(targetError));
            }
        });

        redisClient.on('connect', () => {
            log.info('Redis connected successfully');
            useRedis = true;
        });

        redisClient.on('error', (err) => {
            log.error('Redis error', { error: err.message });
            log.warn('Falling back to in-memory session storage');
            useRedis = false;
            startCleanupTimer(); // Start cleanup when falling back to memory
        });

        redisClient.on('close', () => {
            log.warn('Redis connection closed - using in-memory fallback');
            useRedis = false;
            startCleanupTimer(); // Start cleanup when connection closes
        });

        redisClient.on('reconnecting', () => {
            log.info('Redis reconnecting');
        });

    } catch (error) {
        log.error('Failed to initialize Redis', { error: error.message });
        log.warn('Using in-memory session storage');
        useRedis = false;
        startCleanupTimer(); // Start cleanup on initialization failure
    }
}

/**
 * Get session data for a phone number
 * @param {string} phone - Phone number (e.g., "237677123456")
 * @returns {Promise<Object>} Session data or default { step: 'MAIN_MENU' }
 */
async function getSession(phone) {
    if (!phone) {
        throw new Error('Phone number is required');
    }

    try {
        if (useRedis && redisClient) {
            const key = SESSION_PREFIX + phone;
            const data = await redisClient.get(key);

            if (data) {
                return JSON.parse(data);
            }

            return { step: 'MAIN_MENU' };
        } else {
            // In-memory fallback with TTL
            const sessionData = memorySessions[phone];
            
            // Check if session exists and is not expired
            if (sessionData) {
                if (sessionData.expiresAt > Date.now()) {
                    return sessionData.data;
                } else {
                    // Session expired, clean it up
                    delete memorySessions[phone];
                }
            }
            
            return { step: 'MAIN_MENU' };
        }
    } catch (error) {
        log.error('Error getting session', { error: error.message });

        if (useRedis) {
            // When Redis is configured but unavailable, return clean default
            // to avoid data inconsistency from stale in-memory data
            log.warn('Redis unavailable while getting session - returning default session state');
            return { step: 'MAIN_MENU' };
        }
        
        // In-memory-only mode: fall back to in-memory session or default
        return memorySessions[phone] || { step: 'MAIN_MENU' };
    }
}

/**
 * Set/update session data for a phone number
 * @param {string} phone - Phone number
 * @param {Object} data - Session data to merge
 * @returns {Promise<void>}
 */
async function setSession(phone, data) {
    if (!phone) {
        throw new Error('Phone number is required');
    }

    try {
        if (useRedis && redisClient) {
            const key = SESSION_PREFIX + phone;

            // Get existing session data
            const existingData = await getSession(phone);

            // Merge with new data
            const updatedData = { ...existingData, ...data };

            // Save to Redis with TTL
            await redisClient.setex(key, SESSION_TTL, JSON.stringify(updatedData));
        } else {
            // In-memory fallback with TTL - direct access to avoid recursion
            const now = Date.now();
            const existingSession = memorySessions[phone];
            
            // Get existing data only if session is not expired
            const existingData = (existingSession && existingSession.expiresAt > now)
                ? existingSession.data
                : { step: 'MAIN_MENU' };
            
            const updatedData = { ...existingData, ...data };
            
            memorySessions[phone] = {
                data: updatedData,
                expiresAt: now + SESSION_TTL_MS
            };
        }
    } catch (error) {
        log.error('Error setting session', { error: error.message });

        if (useRedis) {
            // When Redis is configured but unavailable, throw error
            // to avoid data inconsistency from writing to in-memory while Redis is down
            log.warn('Redis unavailable while setting session - operation failed');
            throw new Error('Session storage unavailable');
        }
        
        // In-memory-only mode: fall back to in-memory storage
        memorySessions[phone] = { ...memorySessions[phone], ...data };
    }
}

/**
 * Clear session data for a phone number
 * @param {string} phone - Phone number
 * @returns {Promise<void>}
 */
async function clearSession(phone) {
    if (!phone) {
        throw new Error('Phone number is required');
    }

    try {
        if (useRedis && redisClient) {
            const key = SESSION_PREFIX + phone;
            await redisClient.del(key);
        } else {
            // In-memory fallback
            delete memorySessions[phone];
        }
    } catch (error) {
        log.error('Error clearing session', { error: error.message });

        if (useRedis) {
            // When Redis is configured but unavailable, throw error
            // to avoid data inconsistency from clearing in-memory while Redis is down
            log.warn('Redis unavailable while clearing session - operation failed');
            throw new Error('Session storage unavailable');
        }
        
        // In-memory-only mode: fall back to in-memory storage
        delete memorySessions[phone];
    }
}

/**
 * Get all active sessions (for testing/debugging)
 * @returns {Promise<Object>} All sessions
 */
async function getAllSessions() {
    try {
        if (useRedis && redisClient) {
            const sessions = {};
            let cursor = '0';

            do {
                const [nextCursor, keys] = await redisClient.scan(
                    cursor,
                    'MATCH',
                    SESSION_PREFIX + '*',
                    'COUNT',
                    100
                );
                cursor = nextCursor;

                for (const key of keys) {
                    const phone = key.replace(SESSION_PREFIX, '');
                    const data = await redisClient.get(key);
                    if (data) {
                        sessions[phone] = JSON.parse(data);
                    }
                }
            } while (cursor !== '0');

            return sessions;
        } else {
            // Return only session data, filtering out expired sessions
            const activeSessions = {};
            const now = Date.now();
            
            for (const phone in memorySessions) {
                if (memorySessions[phone].expiresAt > now) {
                    activeSessions[phone] = memorySessions[phone].data;
                } else {
                    // Clean up expired session
                    delete memorySessions[phone];
                }
            }
            
            return activeSessions;
        }
    } catch (error) {
        log.error('Error getting all sessions', { error: error.message });
        
        // Return active sessions only
        const activeSessions = {};
        const now = Date.now();
        
        for (const phone in memorySessions) {
            if (memorySessions[phone].expiresAt > now) {
                activeSessions[phone] = memorySessions[phone].data;
            }
        }
        
        return activeSessions;
    }
}

/**
 * Close Redis connection (for graceful shutdown)
 */
async function closeRedis() {
    // Clear cleanup timer
    if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
    }
    
    if (redisClient) {
        await redisClient.quit();
        log.info('Redis connection closed');
    }
}

// Initialize Redis on module load
initRedis();

module.exports = {
    getSession,
    setSession,
    clearSession,
    getAllSessions,
    closeRedis,
    // Export for testing
    _isUsingRedis: () => useRedis,
    _getMemorySessions: () => memorySessions,
    _cleanupExpiredSessions: cleanupExpiredSessions
};
