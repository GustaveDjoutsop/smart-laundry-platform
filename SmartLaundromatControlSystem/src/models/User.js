const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
        index: true
    },
    password: {
        type: String,
        required: true,
        minlength: 8,
        select: false // Don't include password by default in queries
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    // Updated role enum with new hierarchy
    role: {
        type: String,
        enum: ['admin', 'owner', 'manager', 'accountant', 'employee'],
        default: 'employee',
        index: true
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    lastLogin: {
        type: Date
    },

    // Multi-device session management (replaces single refreshToken)
    refreshTokens: [{
        token: {
            type: String,
            required: true
        },
        deviceInfo: {
            type: String,
            default: 'Unknown device'
        },
        ipAddress: {
            type: String
        },
        createdAt: {
            type: Date,
            default: Date.now
        },
        lastUsed: {
            type: Date,
            default: Date.now
        }
    }],

    // Account lockout for security
    failedLoginAttempts: {
        type: Number,
        default: 0
    },
    lockoutUntil: {
        type: Date
    },

    // Login history for audit trail
    loginHistory: [{
        timestamp: {
            type: Date,
            default: Date.now
        },
        ipAddress: {
            type: String
        },
        userAgent: {
            type: String
        },
        success: {
            type: Boolean,
            required: true
        }
    }],

    // Password change tracking (for token invalidation)
    passwordChangedAt: {
        type: Date
    },

    // Who created this user (for audit)
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // Force password change on first login
    mustChangePassword: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// Indexes for performance
userSchema.index({ email: 1, isActive: 1 });
userSchema.index({ role: 1, isActive: 1 });

// Hash password before saving
userSchema.pre('save', async function() {
    if (!this.isModified('password')) return;

    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);

    // Track password change time (subtract 1 second to ensure tokens issued after are valid)
    this.passwordChangedAt = new Date(Date.now() - 1000);
});

// Compare password method
userSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

/**
 * Check if the account is currently locked
 * @returns {boolean}
 */
userSchema.methods.isLocked = function() {
    return this.lockoutUntil && this.lockoutUntil > Date.now();
};

/**
 * Get remaining lockout time in minutes
 * @returns {number}
 */
userSchema.methods.getLockoutMinutesRemaining = function() {
    if (!this.isLocked()) return 0;
    return Math.ceil((this.lockoutUntil - Date.now()) / 60000);
};

/**
 * Record a login attempt (success or failure)
 * @param {boolean} success - Whether the login was successful
 * @param {string} ipAddress - IP address of the request
 * @param {string} userAgent - User agent string
 */
userSchema.methods.recordLoginAttempt = async function(success, ipAddress, userAgent) {
    // Add to login history (keep last 50 entries)
    this.loginHistory.unshift({
        timestamp: new Date(),
        ipAddress: ipAddress || 'Unknown',
        userAgent: userAgent || 'Unknown',
        success
    });

    // Trim history to last 50 entries
    if (this.loginHistory.length > 50) {
        this.loginHistory = this.loginHistory.slice(0, 50);
    }

    if (success) {
        // Reset failed attempts on successful login
        this.failedLoginAttempts = 0;
        this.lockoutUntil = null;
        this.lastLogin = new Date();
    } else {
        // Increment failed attempts
        this.failedLoginAttempts += 1;

        // Lock account after 5 failed attempts (30 minute lockout)
        if (this.failedLoginAttempts >= 5) {
            this.lockoutUntil = new Date(Date.now() + 30 * 60 * 1000);
        }
    }

    await this.save();
};

/**
 * Add a new refresh token (max 5 devices)
 * @param {string} token - The refresh token
 * @param {string} deviceInfo - Device/browser info
 * @param {string} ipAddress - IP address
 */
userSchema.methods.addRefreshToken = async function(token, deviceInfo, ipAddress) {
    this.refreshTokens.push({
        token,
        deviceInfo: deviceInfo || 'Unknown device',
        ipAddress: ipAddress || 'Unknown',
        createdAt: new Date(),
        lastUsed: new Date()
    });

    // Keep only the newest 5 tokens (max 5 devices)
    if (this.refreshTokens.length > 5) {
        this.refreshTokens = this.refreshTokens.slice(-5);
    }

    await this.save();
};

/**
 * Remove a specific refresh token (logout from device)
 * @param {string} token - The refresh token to remove
 */
userSchema.methods.removeRefreshToken = async function(token) {
    this.refreshTokens = this.refreshTokens.filter(rt => rt.token !== token);
    await this.save();
};

/**
 * Find and update a refresh token's last used time
 * @param {string} token - The refresh token
 * @returns {boolean} - True if token was found and updated
 */
userSchema.methods.updateRefreshTokenUsage = async function(token) {
    const tokenRecord = this.refreshTokens.find(rt => rt.token === token);
    if (tokenRecord) {
        tokenRecord.lastUsed = new Date();
        await this.save();
        return true;
    }
    return false;
};

/**
 * Check if a refresh token exists for this user
 * @param {string} token - The refresh token to check
 * @returns {boolean}
 */
userSchema.methods.hasRefreshToken = function(token) {
    return this.refreshTokens.some(rt => rt.token === token);
};

/**
 * Invalidate all refresh tokens (for password change or security)
 */
userSchema.methods.invalidateAllTokens = async function() {
    this.refreshTokens = [];
    await this.save();
};

/**
 * Get active sessions info (without exposing tokens)
 * @returns {Array}
 */
userSchema.methods.getActiveSessions = function() {
    return this.refreshTokens.map((rt, index) => ({
        index,
        deviceInfo: rt.deviceInfo,
        ipAddress: rt.ipAddress,
        createdAt: rt.createdAt,
        lastUsed: rt.lastUsed
    }));
};

/**
 * Revoke a specific session by index
 * @param {number} sessionIndex - Index of the session to revoke
 */
userSchema.methods.revokeSession = async function(sessionIndex) {
    if (sessionIndex >= 0 && sessionIndex < this.refreshTokens.length) {
        this.refreshTokens.splice(sessionIndex, 1);
        await this.save();
        return true;
    }
    return false;
};

// Remove sensitive data when converting to JSON
userSchema.methods.toJSON = function() {
    const user = this.toObject();
    delete user.password;
    delete user.refreshTokens;
    delete user.loginHistory;
    delete user.__v;
    return user;
};

// Virtual for full name (if we add firstName/lastName later)
userSchema.virtual('displayName').get(function() {
    return this.name;
});

module.exports = mongoose.model('User', userSchema);
