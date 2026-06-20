/**
 * Environment Setup for Tests
 * This file runs BEFORE any test files are loaded
 * Use it to set environment variables that modules need during import
 */

// Set required environment variables BEFORE any modules are loaded
if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'test-jwt-secret-key-32-chars-long-for-testing-purposes';
}

if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
}

// Set optional test environment variables
if (!process.env.CAMPAY_WEBHOOK_SECRET) {
    process.env.CAMPAY_WEBHOOK_SECRET = 'test-campay-webhook-secret';
}

if (!process.env.META_TOKEN) {
    process.env.META_TOKEN = 'test-meta-token-for-whatsapp';
}

console.log('✅ Test environment variables configured');
