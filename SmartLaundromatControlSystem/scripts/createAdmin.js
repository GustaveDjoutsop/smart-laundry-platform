#!/usr/bin/env node
/**
 * Create First Admin Script - SECURED VERSION v3
 * 
 * Usage:
 *   Local:  node scripts/createAdmin.js
 *   CI/CD:  Set NON_INTERACTIVE=true and ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD
 */

// ============================================
// EARLY STARTUP - Debug info
// ============================================
console.log('🚀 Starting createAdmin script...');
console.log('   NODE_ENV:', process.env.NODE_ENV || 'development');
console.log('   NON_INTERACTIVE:', process.env.NON_INTERACTIVE || 'false');
console.log('   ALLOW_ADMIN_CREATION:', process.env.ALLOW_ADMIN_CREATION || 'false');

// ============================================
// DEPENDENCIES
// ============================================
let mongoose, bcrypt, crypto, readline, yaml, fs, path;

try {
    require('dotenv').config();
    mongoose = require('mongoose');
    bcrypt = require('bcryptjs');
    crypto = require('crypto');
    readline = require('readline');
    yaml = require('js-yaml');
    fs = require('fs');
    path = require('path');
    console.log('✅ Dependencies loaded');
} catch (err) {
    console.error('❌ Failed to load dependencies:', err.message);
    process.exit(1);
}

// ============================================
// SECURITY CHECK
// ============================================
const ADMIN_SETUP_SECRET = process.env.ADMIN_SETUP_SECRET;
const ALLOW_ADMIN_CREATION = process.env.ALLOW_ADMIN_CREATION === 'true';
const NODE_ENV = process.env.NODE_ENV || 'development';

if (NODE_ENV === 'production' && !ADMIN_SETUP_SECRET && !ALLOW_ADMIN_CREATION) {
    console.error('❌ SECURITY ERROR: Admin creation is locked in production!');
    process.exit(1);
}
console.log('✅ Security check passed');

// ============================================
// CONFIGURATION
// ============================================
let config = {};
try {
    const configPath = path.join(__dirname, '../config/environments/' + NODE_ENV + '.yml');
    if (fs.existsSync(configPath)) {
        config = yaml.load(fs.readFileSync(configPath, 'utf8'));
        console.log('✅ YAML config loaded');
    } else {
        console.log('⚠️  No YAML config, using env vars');
    }
} catch (e) {
    console.log('⚠️  Config error:', e.message);
}

// ============================================
// MONGODB URI
// ============================================
function getMongoURI() {
    if (process.env.MONGO_URI) return process.env.MONGO_URI;
    if (process.env.MONGODB_URI) return process.env.MONGODB_URI;
    
    const db = config.database || {};
    const username = db.username || process.env.MONGO_USERNAME;
    const password = process.env.MONGO_PASSWORD;
    const cluster = db.cluster || process.env.MONGO_CLUSTER;
    const dbName = db.database_name || 'smartlaundry';
    const appName = db.app_name || 'SmartLaundry';
    
    if (!username || !password || !cluster) {
        throw new Error('Missing MongoDB credentials');
    }
    return 'mongodb+srv://' + username + ':' + password + '@' + cluster + '/' + dbName + '?retryWrites=true&w=majority&appName=' + appName;
}

// ============================================
// USER SCHEMA (Inline)
// ============================================
const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, minlength: 8, select: false },
    name: { type: String, required: true, trim: true },
    role: { type: String, enum: ['admin', 'owner', 'manager', 'accountant', 'employee'], default: 'employee' },
    isActive: { type: Boolean, default: true },
    mustChangePassword: { type: Boolean, default: false },
    refreshTokens: [{ token: String, deviceInfo: String, createdAt: Date, lastUsed: Date }],
    failedLoginAttempts: { type: Number, default: 0 },
    lockoutUntil: Date,
    passwordChangedAt: Date,
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

userSchema.pre('save', async function() {
    if (!this.isModified('password')) return;
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    this.passwordChangedAt = new Date(Date.now() - 1000);
});

function getUserModel() {
    return mongoose.models.User || mongoose.model('User', userSchema);
}

// ============================================
// HELPERS
// ============================================
function generateSecurePassword() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%';
    let pwd = '';
    const bytes = crypto.randomBytes(20);
    for (let i = 0; i < 20; i++) pwd += chars[bytes[i] % chars.length];
    return pwd;
}

// ============================================
// NON-INTERACTIVE MODE
// ============================================
async function createAdminNonInteractive() {
    const email = process.env.ADMIN_EMAIL;
    const name = process.env.ADMIN_NAME;
    const password = process.env.ADMIN_PASSWORD || generateSecurePassword();
    const generated = !process.env.ADMIN_PASSWORD;

    console.log('\n📋 Non-interactive mode');
    console.log('   Email:', email);
    console.log('   Name:', name);

    if (!email || !name) {
        throw new Error('ADMIN_EMAIL and ADMIN_NAME required');
    }

    console.log('\n🔌 Connecting to MongoDB...');
    const uri = getMongoURI();
    console.log('   URI:', uri.replace(/:[^:@]+@/, ':***@'));
    
    await mongoose.connect(uri);
    console.log('✅ Connected');

    const User = getUserModel();

    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
        console.log('\n⚠️  Admin exists:', existingAdmin.email);
        if (process.env.FORCE_CREATE !== 'true') {
            console.log('   Use FORCE_CREATE=true to add another');
            await mongoose.disconnect();
            process.exit(0);
        }
    }

    const emailExists = await User.findOne({ email: email.toLowerCase() });
    if (emailExists) {
        throw new Error('Email already registered: ' + email);
    }

    console.log('\n👤 Creating admin...');
    const admin = new User({
        email: email.toLowerCase(),
        password: password,
        name: name,
        role: 'admin',
        isActive: true,
        mustChangePassword: true
    });

    await admin.save();

    console.log('\n========================================');
    console.log('   ✅ ADMIN CREATED!');
    console.log('========================================');
    console.log('   Email:', admin.email);
    console.log('   Name:', admin.name);
    console.log('   ID:', admin._id);
    
    if (generated) {
        console.log('\n🔐 Password:', password);
        console.log('⚠️  SAVE THIS NOW!');
    }
    console.log('========================================\n');

    await mongoose.disconnect();
    process.exit(0);
}

// ============================================
// INTERACTIVE MODE
// ============================================
async function createAdminInteractive() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise(r => rl.question(q, r));

    console.log('\n========================================');
    console.log('   CREATE ADMIN - ' + NODE_ENV.toUpperCase());
    console.log('========================================\n');

    if (NODE_ENV === 'production' && ADMIN_SETUP_SECRET) {
        const secret = await ask('Enter ADMIN_SETUP_SECRET: ');
        if (secret !== ADMIN_SETUP_SECRET) {
            console.error('❌ Invalid secret');
            rl.close();
            process.exit(1);
        }
    }

    try {
        console.log('Connecting...');
        await mongoose.connect(getMongoURI());
        console.log('✅ Connected\n');

        const User = getUserModel();
        const existing = await User.findOne({ role: 'admin' });
        if (existing) {
            console.log('⚠️  Admin exists:', existing.email);
            const ok = await ask('Create another? (yes/no): ');
            if (ok !== 'yes') { rl.close(); process.exit(0); }
        }

        const email = await ask('Email: ');
        if (!email.includes('@')) throw new Error('Invalid email');
        if (await User.findOne({ email: email.toLowerCase() })) throw new Error('Email taken');

        const name = await ask('Name: ');
        if (name.length < 2) throw new Error('Name too short');

        const suggested = generateSecurePassword();
        console.log('Suggested:', suggested);
        const useIt = await ask('Use it? (yes/no): ');
        const password = useIt === 'yes' ? suggested : await ask('Password (8+ chars): ');
        if (password.length < 8) throw new Error('Too short');

        const admin = new User({
            email: email.toLowerCase(),
            password: password,
            name: name,
            role: 'admin',
            isActive: true,
            mustChangePassword: true
        });
        await admin.save();

        console.log('\n✅ Created:', admin.email);
        if (useIt === 'yes') console.log('🔐 Password:', password);

    } catch (e) {
        console.error('❌', e.message);
        process.exit(1);
    } finally {
        rl.close();
        await mongoose.disconnect().catch(() => {});
    }
}

// ============================================
// MAIN
// ============================================
async function main() {
    try {
        if (process.env.NON_INTERACTIVE === 'true') {
            await createAdminNonInteractive();
        } else {
            await createAdminInteractive();
        }
    } catch (err) {
        console.error('\n❌ Fatal:', err.message);
        console.error(err.stack);
        process.exit(1);
    }
}

main();