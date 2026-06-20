const mongoose = require('mongoose');
const config = require('./env');

// Check if auto-seeding is enabled via env var or YAML config
const autoSeedFromYaml = config._yaml?.AUTO_SEED_USERS === true;

// Default users to seed in non-production environments
// Roles: admin, owner, manager, accountant, employee
const defaultUsers = [
    { email: 'admin@laundromat.com', password: 'Admin123!', name: 'System Admin', role: 'admin', isActive: true },
    { email: 'owner@laundromat.com', password: 'Owner123!', name: 'Business Owner', role: 'owner', isActive: true },
    { email: 'manager@laundromat.com', password: 'Manager123!', name: 'Operations Manager', role: 'manager', isActive: true },
    { email: 'accountant@laundromat.com', password: 'Accountant123!', name: 'Financial Accountant', role: 'accountant', isActive: true },
    { email: 'employee@laundromat.com', password: 'Employee123!', name: 'Staff Employee', role: 'employee', isActive: true },
];

const seedUsers = async () => {
    // Auto-seed users when:
    // 1. AUTO_SEED_USERS=true env var is set, OR
    // 2. AUTO_SEED_USERS: true in YAML config (e.g., test.yml), OR
    // 3. Running in development/test/staging environment
    const shouldSeed = process.env.AUTO_SEED_USERS === 'true' ||
        autoSeedFromYaml ||
        process.env.NODE_ENV === 'development' ||
        process.env.NODE_ENV === 'test' ||
        process.env.NODE_ENV === 'staging';

    if (!shouldSeed) {
        return;
    }

    try {
        const User = require('../models/User');

        for (const userData of defaultUsers) {
            const existingUser = await User.findOne({ email: userData.email });
            if (!existingUser) {
                const user = new User(userData);
                await user.save();
                console.log(`🌱 Seeded user: ${userData.email} (${userData.role})`);
            }
        }
    } catch (error) {
        console.error('⚠️  User seeding error:', error.message);
    }
};

const connectDB = async () => {
    if (!config.MONGO_URI) {
        console.log('⚠️  MongoDB URI not configured - running without database');
        return;
    }

    try {
        await mongoose.connect(config.MONGO_URI);
        if (process.env.NODE_ENV !== 'test') {
            console.log('✅ MongoDB connected successfully');
        }

        // Auto-seed users after successful connection
        await seedUsers();
    } catch (error) {
        console.error('❌ MongoDB connection error:', error.message);
        console.log('⚠️  Continuing without database...');
    }
};

module.exports = connectDB;
