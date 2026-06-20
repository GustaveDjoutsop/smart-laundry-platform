/**
 * Authentication and Authorization Middleware
 * Handles JWT verification, role-based access control, and permission checks
 */

const User = require('../models/User');
const authService = require('../services/authService');
const { hasPermission: checkPermission, canAssignRole, ROLE_LEVELS } = require('../config/permissions');

/**
 * Authentication middleware
 * Verifies JWT token and attaches user info to request
 */
const authenticate = async (req, res, next) => {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'No token provided',
                code: 'NO_TOKEN'
            });
        }

        const token = authHeader.split(' ')[1];

        // Verify token
        let decoded;
        try {
            decoded = authService.verifyAccessToken(token);
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(401).json({
                    success: false,
                    error: 'Token expired',
                    code: 'TOKEN_EXPIRED'
                });
            }
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                code: 'INVALID_TOKEN'
            });
        }

        // Fetch user to check if still active and password hasn't changed
        const user = await User.findById(decoded.userId);

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                error: 'Account deactivated',
                code: 'ACCOUNT_DEACTIVATED'
            });
        }

        // Check if password was changed after token was issued
        if (authService.isTokenIssuedBeforePasswordChange(decoded.iat, user.passwordChangedAt)) {
            return res.status(401).json({
                success: false,
                error: 'Token invalidated due to password change. Please login again.',
                code: 'PASSWORD_CHANGED'
            });
        }

        // Attach user info to request
        req.user = {
            userId: decoded.userId,
            email: decoded.email,
            role: decoded.role,
            roleLevel: ROLE_LEVELS[decoded.role] || 0
        };

        // Also attach full user document for methods that need it
        req.userDocument = user;

        next();
    } catch (error) {
        console.error('Auth middleware error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during authentication'
        });
    }
};

/**
 * Role-based authorization middleware
 * @param {...string} allowedRoles - Roles that can access the route
 */
const authorize = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated',
                code: 'NOT_AUTHENTICATED'
            });
        }

        if (!allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied. Insufficient role.',
                requiredRoles: allowedRoles,
                userRole: req.user.role,
                code: 'INSUFFICIENT_ROLE'
            });
        }

        next();
    };
};

/**
 * Permission-based authorization middleware
 * Uses centralized permissions config
 * @param {string} permission - Permission to check (e.g., 'users:create')
 */
const hasPermission = (permission) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated',
                code: 'NOT_AUTHENTICATED'
            });
        }

        if (!checkPermission(req.user.role, permission)) {
            return res.status(403).json({
                success: false,
                error: 'Access denied. Missing required permission.',
                requiredPermission: permission,
                userRole: req.user.role,
                code: 'INSUFFICIENT_PERMISSION'
            });
        }

        next();
    };
};

/**
 * Check if user can assign a specific role
 * Used when creating or updating users
 * @param {string} targetRoleField - Request body field containing the target role (default: 'role')
 */
const canAssignRoleMiddleware = (targetRoleField = 'role') => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated',
                code: 'NOT_AUTHENTICATED'
            });
        }

        const targetRole = req.body[targetRoleField];

        // If no role is being assigned, skip this check
        if (!targetRole) {
            return next();
        }

        if (!canAssignRole(req.user.role, targetRole)) {
            return res.status(403).json({
                success: false,
                error: `Cannot assign role: ${targetRole}. Insufficient privileges.`,
                code: 'CANNOT_ASSIGN_ROLE'
            });
        }

        next();
    };
};

/**
 * Minimum role level middleware
 * Requires user to have at least the specified role level
 * @param {number} minLevel - Minimum role level required
 */
const requireRoleLevel = (minLevel) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Not authenticated',
                code: 'NOT_AUTHENTICATED'
            });
        }

        const userLevel = ROLE_LEVELS[req.user.role] || 0;

        if (userLevel < minLevel) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient role level',
                requiredLevel: minLevel,
                userLevel: userLevel,
                code: 'INSUFFICIENT_ROLE_LEVEL'
            });
        }

        next();
    };
};

/**
 * Optional authentication middleware
 * Attaches user info if token is valid, but doesn't block if not
 */
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return next();
        }

        const token = authHeader.split(' ')[1];

        try {
            const decoded = authService.verifyAccessToken(token);
            req.user = {
                userId: decoded.userId,
                email: decoded.email,
                role: decoded.role,
                roleLevel: ROLE_LEVELS[decoded.role] || 0
            };
        } catch {
            // Token invalid, but that's okay for optional auth
        }

        next();
    } catch (error) {
        next();
    }
};

module.exports = {
    authenticate,
    authorize,
    hasPermission,
    canAssignRoleMiddleware,
    requireRoleLevel,
    optionalAuth
};
