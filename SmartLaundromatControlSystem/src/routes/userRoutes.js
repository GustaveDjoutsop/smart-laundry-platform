/**
 * User Management Routes
 * API endpoints for user CRUD operations
 */

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, hasPermission, authorize } = require('../middleware/authMiddleware');

// All routes require authentication
router.use(authenticate);

// ============================================
// User CRUD Operations
// ============================================

/**
 * GET /api/users
 * Get all users with optional filtering and pagination
 * Query params: page, limit, role, isActive, search
 */
router.get('/',
    hasPermission('users:read'),
    userController.getUsers
);

/**
 * GET /api/users/:id
 * Get a specific user by ID
 */
router.get('/:id',
    hasPermission('users:read'),
    userController.getUserById
);

/**
 * POST /api/users
 * Create a new user
 * Body: { email, password, name, role }
 */
router.post('/',
    hasPermission('users:create'),
    userController.createUser
);

/**
 * PUT /api/users/:id
 * Update a user
 * Body: { name?, email?, role?, isActive? }
 */
router.put('/:id',
    hasPermission('users:update'),
    userController.updateUser
);

/**
 * DELETE /api/users/:id
 * Permanently delete a user (admin only)
 */
router.delete('/:id',
    hasPermission('users:delete'),
    userController.deleteUser
);

// ============================================
// User Status Management
// ============================================

/**
 * POST /api/users/:id/deactivate
 * Deactivate a user (soft delete)
 */
router.post('/:id/deactivate',
    hasPermission('users:update'),
    userController.deactivateUser
);

/**
 * POST /api/users/:id/activate
 * Reactivate a user
 */
router.post('/:id/activate',
    hasPermission('users:update'),
    userController.activateUser
);

// ============================================
// Session Management
// ============================================

/**
 * GET /api/users/:id/sessions
 * Get active sessions for a user
 */
router.get('/:id/sessions',
    hasPermission('users:read'),
    userController.getSessions
);

/**
 * DELETE /api/users/:id/sessions/:sessionIndex
 * Revoke a specific session
 */
router.delete('/:id/sessions/:sessionIndex',
    hasPermission('users:update'),
    userController.revokeSession
);

// ============================================
// Login History
// ============================================

/**
 * GET /api/users/:id/login-history
 * Get login history for a user
 * Query params: limit (default 20)
 */
router.get('/:id/login-history',
    hasPermission('users:read'),
    userController.getLoginHistory
);

// ============================================
// Password Management
// ============================================

/**
 * POST /api/users/:id/reset-password
 * Reset a user's password (admin/owner only)
 * Body: { newPassword }
 */
router.post('/:id/reset-password',
    authorize('admin', 'owner'),
    userController.resetPassword
);

module.exports = router;
