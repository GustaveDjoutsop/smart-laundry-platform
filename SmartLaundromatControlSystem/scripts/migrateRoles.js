#!/usr/bin/env node
/**
 * Role Migration Script
 * Migrates existing users from old role system to new role system
 *
 * Changes:
 * - 'staff' role -> 'employee' role
 * - Adds new schema fields with defaults
 *
 * Usage:
 *   node scripts/migrateRoles.js
 *
 * Environment:
 *   Set MONGO_URI in .env or pass as environment variable
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/laundry_db';

async function migrateRoles() {
    console.log('🔄 Starting role migration...\n');

    try {
        // Connect to MongoDB
        console.log(`📡 Connecting to MongoDB: ${MONGO_URI.replace(/\/\/.*@/, '//*****@')}`);
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB\n');

        // Get direct access to the collection (bypass Mongoose schema validation for migration)
        const db = mongoose.connection.db;
        const usersCollection = db.collection('users');

        // Step 1: Migrate 'staff' role to 'employee'
        console.log('📋 Step 1: Migrating "staff" role to "employee"...');
        const staffMigrationResult = await usersCollection.updateMany(
            { role: 'staff' },
            { $set: { role: 'employee' } }
        );
        console.log(`   ✓ Migrated ${staffMigrationResult.modifiedCount} users from 'staff' to 'employee'\n`);

        // Step 2: Add new schema fields with defaults to users missing them
        console.log('📋 Step 2: Adding new schema fields to existing users...');

        // Add refreshTokens array if missing
        const refreshTokensResult = await usersCollection.updateMany(
            { refreshTokens: { $exists: false } },
            { $set: { refreshTokens: [] } }
        );
        console.log(`   ✓ Added refreshTokens field to ${refreshTokensResult.modifiedCount} users`);

        // Add failedLoginAttempts if missing
        const failedAttemptsResult = await usersCollection.updateMany(
            { failedLoginAttempts: { $exists: false } },
            { $set: { failedLoginAttempts: 0 } }
        );
        console.log(`   ✓ Added failedLoginAttempts field to ${failedAttemptsResult.modifiedCount} users`);

        // Add loginHistory array if missing
        const loginHistoryResult = await usersCollection.updateMany(
            { loginHistory: { $exists: false } },
            { $set: { loginHistory: [] } }
        );
        console.log(`   ✓ Added loginHistory field to ${loginHistoryResult.modifiedCount} users`);

        // Remove old single refreshToken field if exists
        const removeOldTokenResult = await usersCollection.updateMany(
            { refreshToken: { $exists: true } },
            { $unset: { refreshToken: '' } }
        );
        console.log(`   ✓ Removed old refreshToken field from ${removeOldTokenResult.modifiedCount} users\n`);

        // Step 3: Show summary of current roles
        console.log('📊 Step 3: Current role distribution:');
        const roleCounts = await usersCollection.aggregate([
            { $group: { _id: '$role', count: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]).toArray();

        for (const { _id: role, count } of roleCounts) {
            console.log(`   • ${role}: ${count} user(s)`);
        }

        // Step 4: Verify no invalid roles remain
        console.log('\n📋 Step 4: Checking for invalid roles...');
        const validRoles = ['admin', 'owner', 'manager', 'accountant', 'employee'];
        const invalidRoles = await usersCollection.find({
            role: { $nin: validRoles }
        }).toArray();

        if (invalidRoles.length > 0) {
            console.log(`   ⚠️  Found ${invalidRoles.length} users with invalid roles:`);
            for (const user of invalidRoles) {
                console.log(`      - ${user.email}: "${user.role}"`);
            }
            console.log('   Please manually update these users to valid roles.');
        } else {
            console.log('   ✓ All users have valid roles');
        }

        console.log('\n✅ Migration completed successfully!');
        console.log('\n📝 Test Credentials (for development):');
        console.log('   • admin@laundromat.com / Admin123!');
        console.log('   • owner@laundromat.com / Owner123!');
        console.log('   • manager@laundromat.com / Manager123!');
        console.log('   • accountant@laundromat.com / Accountant123!');
        console.log('   • employee@laundromat.com / Employee123!');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('\n📡 Disconnected from MongoDB');
    }
}

// Run migration
migrateRoles();
