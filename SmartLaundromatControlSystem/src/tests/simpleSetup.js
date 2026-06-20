/**
 * Simple Test Setup (No Database)
 * For tests that don't require MongoDB (utils, helpers, simple functions)
 */

// Suppress console output during tests (except errors)
global.console = {
    ...console,
    log: jest.fn(), // Suppress console.log
    warn: jest.fn(), // Suppress console.warn
    error: console.error, // Keep console.error for debugging
};
