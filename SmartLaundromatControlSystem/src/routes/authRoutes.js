/**
 * Authentication Routes
 * API endpoints for authentication operations
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');

// ============================================
// Public Routes (No Authentication Required)
// ============================================

/**
 * @route   POST /api/auth/login
 * @desc    Authenticate user and return JWT tokens
 * @access  Public
 */
router.post('/login', authController.login);

/**
 * @route   POST /api/auth/refresh
 * @desc    Refresh JWT token using refresh token
 * @access  Public
 */
router.post('/refresh', authController.refreshToken);

// ============================================
// Protected Routes (Authentication Required)
// ============================================

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user (invalidate current device's refresh token)
 * @access  Private
 */
router.post('/logout', authenticate, authController.logout);

/**
 * @route   POST /api/auth/logout-all
 * @desc    Logout from all devices (invalidate all refresh tokens)
 * @access  Private
 */
router.post('/logout-all', authenticate, authController.logoutAll);

/**
 * @route   GET /api/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me', authenticate, authController.getProfile);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password (invalidates all sessions)
 * @access  Private
 */
router.post('/change-password', authenticate, authController.changePassword);

/**
 * @route   POST /api/auth/force-change-password
 * @desc    Change password on first login (when mustChangePassword is true)
 * @access  Private
 */
router.post('/force-change-password', authenticate, authController.forceChangePassword);

/**
 * @route   GET /api/auth/sessions
 * @desc    Get all active sessions for current user
 * @access  Private
 */
router.get('/sessions', authenticate, authController.getSessions);

/**
 * @route   DELETE /api/auth/sessions/:index
 * @desc    Revoke a specific session by index
 * @access  Private
 */
router.delete('/sessions/:index', authenticate, authController.revokeSession);

module.exports = router;
