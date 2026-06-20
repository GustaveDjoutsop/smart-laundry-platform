/**
 * Seed script to create initial users in the database
 * Run with: node scripts/seedUsers.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../src/models/User');

// MongoDB connection string - use MONGO_URI (same as server) or fall back
const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/laundry_db';

const users = [
    {
        email: 'admin@laundromat.com',
        password: 'securepassword',
        name: 'Admin User',
        role: 'owner',
        isActive: true
    },
    {
        email: 'owner@laundromat.com',
        password: 'owner123',
        name: 'Owner',
        role: 'owner',
        isActive: true
    },
    {
        email: 'manager@laundromat.com',
        password: 'manager123',
        name: 'Manager',
        role: 'manager',
        isActive: true
    },
    {
        email: 'staff@laundromat.com',
        password: 'staff123',
        name: 'Staff Member',
        role: 'staff',
        isActive: true
    },
    {
        email: 'accountant@laundromat.com',
        password: 'accountant123',
        name: 'Accountant',
        role: 'accountant',
        isActive: true
    }
];

async function seedUsers() {
    try {
        // Connect to MongoDB
        await mongoose.connect(MONGODB_URI);
        console.log('📦 Connected to MongoDB');

        // Clear existing users (optional - comment out in production)
        // await User.deleteMany({});
        // console.log('🗑️  Cleared existing users');

        // Create or update users
        for (const userData of users) {
            const existingUser = await User.findOne({ email: userData.email });

            if (existingUser) {
                console.log(`⏭️  User already exists: ${userData.email}`);
            } else {
                const user = new User(userData);
                await user.save();
                console.log(`✅ Created user: ${userData.email} (${userData.role})`);
            }
        }

        console.log('\n🎉 Seed completed successfully!');
        console.log('\nTest users:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('| Email                      | Password       | Role       |');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        users.forEach(u => {
            console.log(`| ${u.email.padEnd(26)} | ${u.password.padEnd(14)} | ${u.role.padEnd(10)} |`);
        });
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (error) {
        console.error('❌ Seed error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('\n📤 Disconnected from MongoDB');
        process.exit(0);
    }
}

seedUsers();
