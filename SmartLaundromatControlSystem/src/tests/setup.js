/**
 * Global Test Setup
 * Configures MongoDB for all tests
 * - Uses in-memory MongoDB for local development
 * - Uses MongoDB container for Docker environments
 * This file is automatically loaded by Jest before running tests
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const config = require('../config/env');

let mongoServer;

// Detect if running in Docker (Alpine Linux doesn't support mongodb-memory-server)
// In test runs on Linux without MONGO_URI, skip Docker detection to avoid external binary downloads.
const isDocker = process.env.MONGO_URI || (process.platform === 'linux' && process.env.NODE_ENV !== 'test');

// Setup before all tests
beforeAll(async () => {
    let mongoUri;

    if (isDocker) {
        // Use MongoDB container in Docker environment
        mongoUri = config.MONGO_URI || process.env.MONGO_URI || 'mongodb://mongodb:27017/test';
        console.log(`🐳 Using Docker MongoDB: ${mongoUri}`);
    } else {
        // Create in-memory MongoDB instance for local development
        mongoServer = await MongoMemoryServer.create();
        mongoUri = mongoServer.getUri();
        console.log(`💾 Using in-memory MongoDB: ${mongoUri}`);
    }

    // Connect to the database
    await mongoose.connect(mongoUri);
    console.log('✅ Test MongoDB connected');
}, 120000); // 120 second timeout for MongoDB setup (first run needs time to download binaries)

// Cleanup after all tests
afterAll(async () => {
    // Close MongoDB connection
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }

    // Stop in-memory MongoDB server (only if created)
    if (mongoServer) {
        await mongoServer.stop();
    }

    console.log('✅ Test MongoDB disconnected');
}, 60000); // 60 second timeout for cleanup

// Clean up database between tests
afterEach(async () => {
    if (mongoose.connection.readyState === 1) {
        const collections = mongoose.connection.collections;

        // Delete all documents from all collections
        for (const key in collections) {
            await collections[key].deleteMany({});
        }
    }
});

// Suppress console output during tests (except errors)
global.console = {
    ...console,
    log: jest.fn(), // Suppress console.log
    warn: jest.fn(), // Suppress console.warn
    error: console.error, // Keep console.error for debugging
};
