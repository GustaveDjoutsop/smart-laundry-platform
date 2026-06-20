/**
 * User Management Service
 * Handles CRUD operations for users with role-based access control
 */

const User = require('../models/User');
const { canAssignRole, getRoleLevel, getValidRoles } = require('../config/permissions');

const userService = {
    /**
     * Create a new user
     * @param {Object} userData - User data (email, password, name, role)
     * @param {string} creatorId - ID of the user creating this user
     * @param {string} creatorRole - Role of the creator (for permission check)
     * @returns {Object} Created user
     */
    async createUser(userData, creatorId, creatorRole) {
        const { email, password, name, role } = userData;

        // Validate role
        if (!getValidRoles().includes(role)) {
            throw new Error(`Invalid role: ${role}`);
        }

        // Check if creator can assign this role
        if (!canAssignRole(creatorRole, role)) {
            throw new Error(`You cannot create users with role: ${role}`);
        }

        // Check if email already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            throw new Error('Email already registered');
        }

        // Create user
        const user = new User({
            email: email.toLowerCase(),
            password,
            name,
            role,
            createdBy: creatorId,
            isActive: true
        });

        await user.save();

        return user.toJSON();
    },

    /**
     * Get all users with filtering and pagination
     * @param {Object} filters - Filter options
     * @param {Object} pagination - Pagination options
     * @param {string} requesterRole - Role of the requesting user
     * @returns {Object} Users and pagination info
     */
    async getUsers(filters = {}, pagination = {}, requesterRole = null) {
        const { page = 1, limit = 20 } = pagination;
        const { role, isActive, search } = filters;

        // Build query
        const query = {};

        // Non-admin users cannot see admin users
        if (requesterRole !== 'admin') {
            query.role = { $ne: 'admin' };
        }

        // Filter by role
        if (role) {
            if (requesterRole !== 'admin' && role === 'admin') {
                // Non-admin trying to filter for admin users - return empty
                return { users: [], pagination: { page, limit, total: 0, pages: 0 } };
            }
            query.role = role;
        }

        // Filter by active status
        if (isActive !== undefined) {
            query.isActive = isActive;
        }

        // Search by name or email
        if (search) {
            // Sanitize search input to prevent NoSQL injection via regex
            // Escape special regex characters: . * + ? ^ $ { } ( ) | [ ] \
            const sanitizedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.$or = [
                { name: { $regex: sanitizedSearch, $options: 'i' } },
                { email: { $regex: sanitizedSearch, $options: 'i' } }
            ];
        }

        // Execute query with pagination
        const skip = (page - 1) * limit;
        const [users, total] = await Promise.all([
            User.find(query)
                .select('-password -refreshTokens -loginHistory')
                .populate('createdBy', 'name email')
                .skip(skip)
                .limit(limit)
                .sort({ createdAt: -1 }),
            User.countDocuments(query)
        ]);

        return {
            users: users.map(u => u.toJSON()),
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        };
    },

    /**
     * Get a user by ID
     * @param {string} userId - User ID
     * @param {string} requesterRole - Role of the requesting user
     * @returns {Object} User data
     */
    async getUserById(userId, requesterRole = null) {
        const user = await User.findById(userId)
            .select('-password -refreshTokens')
            .populate('createdBy', 'name email');

        if (!user) {
            throw new Error('User not found');
        }

        // Non-admin users cannot view admin users
        if (requesterRole !== 'admin' && user.role === 'admin') {
            throw new Error('Access denied');
        }

        return user.toJSON();
    },

    /**
     * Update a user
     * @param {string} userId - User ID to update
     * @param {Object} updates - Fields to update
     * @param {string} updaterId - ID of the user making the update
     * @param {string} updaterRole - Role of the updater
     * @returns {Object} Updated user
     */
    async updateUser(userId, updates, updaterId, updaterRole) {
        const user = await User.findById(userId);

        if (!user) {
            throw new Error('User not found');
        }

        // Cannot update yourself (use profile update instead)
        if (userId === updaterId) {
            throw new Error('Use profile update to modify your own account');
        }

        // Check role hierarchy - can only modify users at or below your level
        const updaterLevel = getRoleLevel(updaterRole);
        const targetLevel = getRoleLevel(user.role);

        if (updaterRole !== 'admin' && updaterLevel <= targetLevel) {
            throw new Error('Cannot modify user with equal or higher role');
        }

        // Prevent role escalation
        if (updates.role) {
            if (!canAssignRole(updaterRole, updates.role)) {
                throw new Error(`Cannot assign role: ${updates.role}`);
            }
        }

        // Allowed fields to update
        const allowedFields = ['name', 'email', 'role', 'isActive'];
        const filteredUpdates = {};

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                filteredUpdates[field] = updates[field];
            }
        }

        // If email is being changed, check for duplicates
        if (filteredUpdates.email) {
            filteredUpdates.email = filteredUpdates.email.toLowerCase();
            const existing = await User.findOne({
                email: filteredUpdates.email,
                _id: { $ne: userId }
            });
            if (existing) {
                throw new Error('Email already in use');
            }
        }

        const updatedUser = await User.findByIdAndUpdate(
            userId,
            filteredUpdates,
            { new: true, runValidators: true }
        ).select('-password -refreshTokens -loginHistory');

        return updatedUser.toJSON();
    },

    /**
     * Deactivate a user (soft delete)
     * @param {string} userId - User ID to deactivate
     * @param {string} deactivatorId - ID of the user performing deactivation
     * @param {string} deactivatorRole - Role of the deactivator
     * @returns {Object} Deactivated user
     */
    async deactivateUser(userId, deactivatorId, deactivatorRole) {
        const user = await User.findById(userId);

        if (!user) {
            throw new Error('User not found');
        }

        // Cannot deactivate yourself
        if (userId === deactivatorId) {
            throw new Error('Cannot deactivate your own account');
        }

        // Cannot deactivate admin users (unless you're admin)
        if (user.role === 'admin' && deactivatorRole !== 'admin') {
            throw new Error('Cannot deactivate admin users');
        }

        // Check role hierarchy
        const deactivatorLevel = getRoleLevel(deactivatorRole);
        const targetLevel = getRoleLevel(user.role);

        if (deactivatorRole !== 'admin' && deactivatorLevel <= targetLevel) {
            throw new Error('Cannot deactivate user with equal or higher role');
        }

        // Deactivate and invalidate all sessions
        user.isActive = false;
        await user.invalidateAllTokens();

        return user.toJSON();
    },

    /**
     * Reactivate a user
     * @param {string} userId - User ID to reactivate
     * @param {string} reactivatorRole - Role of the reactivator
     * @returns {Object} Reactivated user
     */
    async reactivateUser(userId, reactivatorRole) {
        const user = await User.findById(userId);

        if (!user) {
            throw new Error('User not found');
        }

        // Cannot reactivate admin users (unless you're admin)
        if (user.role === 'admin' && reactivatorRole !== 'admin') {
            throw new Error('Cannot reactivate admin users');
        }

        user.isActive = true;
        await user.save();

        return user.toJSON();
    },

    /**
     * Permanently delete a user (admin only)
     * @param {string} userId - User ID to delete
     * @param {string} deleterId - ID of the user performing deletion
     * @param {string} deleterRole - Role of the deleter
     * @returns {Object} Deletion confirmation
     */
    async deleteUser(userId, deleterId, deleterRole) {
        // Only admin can permanently delete
        if (deleterRole !== 'admin') {
            throw new Error('Only administrators can permanently delete users');
        }

        const user = await User.findById(userId);

        if (!user) {
            throw new Error('User not found');
        }

        // Cannot delete yourself
        if (userId === deleterId) {
            throw new Error('Cannot delete your own account');
        }

        // Cannot delete other admins
        if (user.role === 'admin') {
            throw new Error('Cannot delete admin users');
        }

        await User.findByIdAndDelete(userId);

        return { deleted: true, userId };
    },

    /**
     * Get login history for a user
     * @param {string} userId - User ID
     * @param {number} limit - Number of entries to return
     * @returns {Array} Login history entries
     */
    async getLoginHistory(userId, limit = 20) {
        const user = await User.findById(userId).select('loginHistory');

        if (!user) {
            throw new Error('User not found');
        }

        return user.loginHistory.slice(0, limit);
    },

    /**
     * Get active sessions for a user
     * @param {string} userId - User ID
     * @returns {Array} Active sessions
     */
    async getActiveSessions(userId) {
        const user = await User.findById(userId);

        if (!user) {
            throw new Error('User not found');
        }

        return user.getActiveSessions();
    },

    /**
     * Revoke a specific session for a user
     * @param {string} userId - User ID
     * @param {number} sessionIndex - Index of session to revoke
     * @returns {boolean} Success status
     */
    async revokeSession(userId, sessionIndex) {
        const user = await User.findById(userId);

        if (!user) {
            throw new Error('User not found');
        }

        return user.revokeSession(sessionIndex);
    },

    /**
     * Reset a user's password (admin function)
     * @param {string} userId - User ID
     * @param {string} newPassword - New password
     * @param {string} resetterRole - Role of the user resetting
     * @returns {Object} Success message
     */
    async resetUserPassword(userId, newPassword, resetterRole) {
        if (!['admin', 'owner'].includes(resetterRole)) {
            throw new Error('Insufficient permissions to reset passwords');
        }

        const user = await User.findById(userId).select('+password');

        if (!user) {
            throw new Error('User not found');
        }

        // Cannot reset admin password unless you're admin
        if (user.role === 'admin' && resetterRole !== 'admin') {
            throw new Error('Cannot reset admin password');
        }

        user.password = newPassword;
        await user.save();

        // Invalidate all sessions
        await user.invalidateAllTokens();

        return { message: 'Password reset successfully' };
    }
};

module.exports = userService;
