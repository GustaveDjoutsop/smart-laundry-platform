/**
 * Authentication Service
 * Handles JWT token generation, validation, and refresh token management
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { ROLE_LEVELS } = require('../config/permissions');

// Token configuration
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('FATAL: JWT_SECRET environment variable is required. Server cannot start without it.');
}
const ACCESS_TOKEN_EXPIRES = '15m';  // 15 minutes
const REFRESH_TOKEN_EXPIRES = '7d';  // 7 days

const authService = {
    /**
     * Generate a short-lived access token
     * @param {Object} user - User document
     * @returns {string} JWT access token
     */
    generateAccessToken(user) {
        return jwt.sign(
            {
                userId: user._id,
                email: user.email,
                role: user.role,
                roleLevel: ROLE_LEVELS[user.role] || 0
            },
            JWT_SECRET,
            { expiresIn: ACCESS_TOKEN_EXPIRES }
        );
    },

    /**
     * Generate a long-lived refresh token
     * @param {Object} user - User document
     * @returns {string} JWT refresh token
     */
    generateRefreshToken(user) {
        return jwt.sign(
            {
                userId: user._id,
                type: 'refresh'
            },
            JWT_SECRET,
            { expiresIn: REFRESH_TOKEN_EXPIRES }
        );
    },

    /**
     * Verify an access token
     * @param {string} token - JWT access token
     * @returns {Object} Decoded token payload
     * @throws {Error} If token is invalid or expired
     */
    verifyAccessToken(token) {
        return jwt.verify(token, JWT_SECRET);
    },

    /**
     * Verify a refresh token
     * @param {string} token - JWT refresh token
     * @returns {Object} Decoded token payload
     * @throws {Error} If token is invalid, expired, or not a refresh token
     */
    verifyRefreshToken(token) {
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.type !== 'refresh') {
            throw new Error('Invalid token type');
        }
        return decoded;
    },

    /**
     * Validate a refresh token and return the associated user
     * @param {string} token - Refresh token
     * @returns {Object|null} User document or null if invalid
     */
    async validateRefreshToken(token) {
        try {
            const decoded = this.verifyRefreshToken(token);

            const user = await User.findById(decoded.userId);

            if (!user || !user.isActive) {
                return null;
            }

            // Check if token exists in user's refresh tokens
            if (!user.hasRefreshToken(token)) {
                return null;
            }

            // Update last used timestamp
            await user.updateRefreshTokenUsage(token);

            return user;
        } catch (error) {
            return null;
        }
    },

    /**
     * Check if a token was issued before a password change
     * @param {number} tokenIat - Token issued at timestamp (seconds)
     * @param {Date} passwordChangedAt - Date when password was changed
     * @returns {boolean} True if token was issued before password change
     */
    isTokenIssuedBeforePasswordChange(tokenIat, passwordChangedAt) {
        if (!passwordChangedAt) return false;

        const passwordChangedTimestamp = Math.floor(passwordChangedAt.getTime() / 1000);
        return tokenIat < passwordChangedTimestamp;
    },

    /**
     * Decode a token without verification (for debugging)
     * @param {string} token - JWT token
     * @returns {Object|null} Decoded payload or null
     */
    decodeToken(token) {
        try {
            return jwt.decode(token);
        } catch {
            return null;
        }
    },

    /**
     * Get token expiration time in seconds
     * @returns {number} Access token expiration in seconds
     */
    getAccessTokenExpiresIn() {
        return 15 * 60; // 15 minutes in seconds
    },

    /**
     * Get refresh token expiration time in seconds
     * @returns {number} Refresh token expiration in seconds
     */
    getRefreshTokenExpiresIn() {
        return 7 * 24 * 60 * 60; // 7 days in seconds
    }
};

module.exports = authService;
