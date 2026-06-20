/**
 * User Management Controller
 * Handles HTTP requests for user CRUD operations
 */

const userService = require('../services/userService');
const { log } = require('../utils/logger');

/**
 * GET /api/users
 * Get all users with optional filtering and pagination
 */
exports.getUsers = async (req, res) => {
    try {
        const { page, limit, role, isActive, search } = req.query;

        const filters = {
            role: role || undefined,
            isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
            search: search || undefined
        };

        const pagination = {
            page: parseInt(page) || 1,
            limit: parseInt(limit) || 20
        };

        const result = await userService.getUsers(filters, pagination, req.user.role);

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        log.error('Get users error', { error: error.message });
        res.status(500).json({
            success: false,
            error: error.message || 'Failed to fetch users'
        });
    }
};

/**
 * GET /api/users/:id
 * Get a specific user by ID
 */
exports.getUserById = async (req, res) => {
    try {
        const user = await userService.getUserById(req.params.id, req.user.role);

        res.json({
            success: true,
            user
        });
    } catch (error) {
        log.error('Get user error', { error: error.message });
        const status = error.message === 'User not found' ? 404 :
                       error.message === 'Access denied' ? 403 : 500;
        res.status(status).json({
            success: false,
            error: error.message || 'Failed to fetch user'
        });
    }
};

/**
 * POST /api/users
 * Create a new user
 */
exports.createUser = async (req, res) => {
    try {
        const { email, password, name, role } = req.body;

        // Validate required fields
        if (!email || !password || !name || !role) {
            return res.status(400).json({
                success: false,
                error: 'Email, password, name, and role are required'
            });
        }

        // Validate password length
        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 8 characters'
            });
        }

        const user = await userService.createUser(
            { email, password, name, role },
            req.user.userId,
            req.user.role
        );

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            user
        });
    } catch (error) {
        log.error('Create user error', { error: error.message });
        const status = error.message.includes('already') ? 409 :
                       error.message.includes('cannot') ? 403 :
                       error.message.includes('Invalid') ? 400 : 500;
        res.status(status).json({
            success: false,
            error: error.message || 'Failed to create user'
        });
    }
};

/**
 * PUT /api/users/:id
 * Update a user
 */
exports.updateUser = async (req, res) => {
    try {
        const user = await userService.updateUser(
            req.params.id,
            req.body,
            req.user.userId,
            req.user.role
        );

        res.json({
            success: true,
            message: 'User updated successfully',
            user
        });
    } catch (error) {
        log.error('Update user error', { error: error.message });
        const status = error.message === 'User not found' ? 404 :
                       error.message.includes('Cannot') || error.message.includes('cannot') ? 403 :
                       error.message.includes('already') ? 409 : 500;
        res.status(status).json({
            success: false,
            error: error.message || 'Failed to update user'
        });
    }
};

/**
 * DELETE /api/users/:id
 * Permanently delete a user (admin only)
 */
exports.deleteUser = async (req, res) => {
    try {
        await userService.deleteUser(
            req.params.id,
            req.user.userId,
            req.user.role
        );

        res.json({
            success: true,
            message: 'User deleted permanently'
        });
    } catch (error) {
        log.error('Delete user error', { error: error.message });
        const status = error.message === 'User not found' ? 404 :
                       error.message.includes('Only') || error.message.includes('Cannot') ? 403 : 500;
        res.status(status).json({
            success: false,
            error: error.message || 'Failed to delete user'
        });
    }
};

/**
 * POST /api/users/:id/deactivate
 * Deactivate a user (soft delete)
 */
exports.deactivateUser = async (req, res) => {
    try {
        const user = await userService.deactivateUser(
            req.params.id,
            req.user.userId,
            req.user.role
        );

        res.json({
            success: true,
            message: 'User deactivated successfully',
            user
        });
    } catch (error) {
        log.error('Deactivate user error', { error: error.message });
        const status = error.message === 'User not found' ? 404 :
                       error.message.includes('Cannot') || error.message.includes('cannot') ? 403 : 500;
        res.status(status).json({
            success: false,
            error: error.message || 'Failed to deactivate user'
        });
    }
};

/**
 * POST /api/users/:id/activate
 * Reactivate a user
 */
exports.activateUser = async (req, res) => {
    try {
        const user = await userService.reactivateUser(
            req.params.id,
            req.user.role
        );

        res.json({
            success: true,
            message: 'User activated successfully',
            user
        });
    } catch (error) {
        log.error('Activate user error', { error: error.message });
        const status = error.message === 'User not found' ? 404 :
                       error.message.includes('Cannot') ? 403 : 500;
        res.status(status).json({
            success: false,
            error: error.message || 'Failed to activate user'
        });
    }
};

/**
 * GET /api/users/:id/sessions
 * Get active sessions for a user
 */
exports.getSessions = async (req, res) => {
    try {
        const sessions = await userService.getActiveSessions(req.params.id);

        res.json({
            success: true,
            sessions,
            count: sessions.length
        });
    } catch (error) {
        log.error('Get sessions error', { error: error.message });
        const status = error.message === 'User not found' ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error.message || 'Failed to fetch sessions'
        });
    }
};

/**
 * DELETE /api/users/:id/sessions/:sessionIndex
 * Revoke a specific session
 */
exports.revokeSession = async (req, res) => {
    try {
        const sessionIndex = parseInt(req.params.sessionIndex);

        if (isNaN(sessionIndex) || sessionIndex < 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid session index'
            });
        }

        const revoked = await userService.revokeSession(req.params.id, sessionIndex);

        if (!revoked) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        res.json({
            success: true,
            message: 'Session revoked successfully'
        });
    } catch (error) {
        log.error('Revoke session error', { error: error.message });
        const status = error.message === 'User not found' ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error.message || 'Failed to revoke session'
        });
    }
};

/**
 * GET /api/users/:id/login-history
 * Get login history for a user
 */
exports.getLoginHistory = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const history = await userService.getLoginHistory(req.params.id, limit);

        res.json({
            success: true,
            history,
            count: history.length
        });
    } catch (error) {
        log.error('Get login history error', { error: error.message });
        const status = error.message === 'User not found' ? 404 : 500;
        res.status(status).json({
            success: false,
            error: error.message || 'Failed to fetch login history'
        });
    }
};

/**
 * POST /api/users/:id/reset-password
 * Reset a user's password (admin/owner only)
 */
exports.resetPassword = async (req, res) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 8 characters'
            });
        }

        const result = await userService.resetUserPassword(
            req.params.id,
            newPassword,
            req.user.role
        );

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        log.error('Reset password error', { error: error.message });
        const status = error.message === 'User not found' ? 404 :
                       error.message.includes('Insufficient') || error.message.includes('Cannot') ? 403 : 500;
        res.status(status).json({
            success: false,
            error: error.message || 'Failed to reset password'
        });
    }
};
