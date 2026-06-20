/**
 * Authentication Controller
 * Handles login, logout, token refresh, and password management
 */

const User = require('../models/User');
const TimeEntry = require('../models/TimeEntry');
const authService = require('../services/authService');

/**
 * POST /api/auth/login
 * Authenticate user and return JWT tokens
 */
exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'Unknown';
        const userAgent = req.headers['user-agent'] || 'Unknown';

        // Validate input
        if (!email || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email and password are required'
            });
        }

        // Find user by email (include password for comparison)
        const user = await User.findOne({ email: email.toLowerCase() }).select('+password');

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Check if account is locked
        if (user.isLocked()) {
            const remainingMinutes = user.getLockoutMinutesRemaining();
            return res.status(423).json({
                success: false,
                error: 'Account is locked due to too many failed login attempts',
                code: 'ACCOUNT_LOCKED',
                remainingMinutes,
                lockedUntil: user.lockoutUntil
            });
        }

        // Verify password
        const isMatch = await user.comparePassword(password);

        // Record login attempt (success or failure)
        await user.recordLoginAttempt(isMatch, ipAddress, userAgent);

        if (!isMatch) {
            const attemptsRemaining = Math.max(0, 5 - user.failedLoginAttempts);
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password',
                attemptsRemaining: attemptsRemaining > 0 ? attemptsRemaining : undefined,
                warning: attemptsRemaining <= 2 && attemptsRemaining > 0
                    ? `Warning: ${attemptsRemaining} attempt(s) remaining before account lockout`
                    : undefined
            });
        }

        // Check if user is active
        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                error: 'Account is deactivated. Contact administrator.',
                code: 'ACCOUNT_DEACTIVATED'
            });
        }

        // Generate tokens (15-min access token, 7-day refresh token)
        const accessToken = authService.generateAccessToken(user);
        const refreshToken = authService.generateRefreshToken(user);

        // Store refresh token (supports multi-device, max 5)
        await user.addRefreshToken(refreshToken, userAgent, ipAddress);

        // Auto clock-in on login
        let clockedIn = false;
        try {
            const { isClockedIn } = await TimeEntry.getClockStatus(user._id);
            if (!isClockedIn) {
                await TimeEntry.create({
                    employee: user._id,
                    type: 'clock_in',
                    method: 'automatic',
                    ipAddress,
                    userAgent,
                    notes: 'Automatic clock-in on login'
                });
                clockedIn = true;
            }
        } catch (clockError) {
            // Log but don't fail the login if clock-in fails
            console.error('Auto clock-in error:', clockError);
        }

        // Return tokens and user info
        res.json({
            success: true,
            token: accessToken,
            refreshToken,
            expiresIn: authService.getAccessTokenExpiresIn(), // 900 seconds (15 min)
            mustChangePassword: user.mustChangePassword || false,
            clockedIn,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                role: user.role,
                isActive: user.isActive,
                createdAt: user.createdAt,
                lastLogin: user.lastLogin
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during login'
        });
    }
};

/**
 * POST /api/auth/logout
 * Logout user (invalidate refresh token for current device)
 */
exports.logout = async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (req.user && refreshToken) {
            const user = await User.findById(req.user.userId);
            if (user) {
                await user.removeRefreshToken(refreshToken);
            }
        }

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during logout'
        });
    }
};

/**
 * POST /api/auth/logout-all
 * Logout from all devices (invalidate all refresh tokens)
 */
exports.logoutAll = async (req, res) => {
    try {
        if (req.user) {
            const user = await User.findById(req.user.userId);
            if (user) {
                await user.invalidateAllTokens();
            }
        }

        res.json({
            success: true,
            message: 'Logged out from all devices'
        });
    } catch (error) {
        console.error('Logout all error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during logout'
        });
    }
};

/**
 * GET /api/auth/me
 * Get current user profile
 */
exports.getProfile = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        res.json({
            success: true,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                role: user.role,
                isActive: user.isActive,
                createdAt: user.createdAt,
                lastLogin: user.lastLogin
            }
        });
    } catch (error) {
        console.error('Get profile error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * POST /api/auth/refresh
 * Refresh JWT token using refresh token
 */
exports.refreshToken = async (req, res) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(400).json({
                success: false,
                error: 'Refresh token is required'
            });
        }

        // Validate refresh token and get user
        const user = await authService.validateRefreshToken(refreshToken);

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired refresh token',
                code: 'INVALID_REFRESH_TOKEN'
            });
        }

        // Generate new access token (keep the same refresh token)
        const newAccessToken = authService.generateAccessToken(user);

        res.json({
            success: true,
            token: newAccessToken,
            expiresIn: authService.getAccessTokenExpiresIn()
        });
    } catch (error) {
        console.error('Refresh token error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * POST /api/auth/change-password
 * Change user password (invalidates all sessions)
 */
exports.changePassword = async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Current password and new password are required'
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 8 characters'
            });
        }

        // Get user with password field
        const user = await User.findById(req.user.userId).select('+password');
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Verify current password
        const isMatch = await user.comparePassword(currentPassword);
        if (!isMatch) {
            return res.status(401).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }

        // Update password (this will also set passwordChangedAt in the pre-save hook)
        user.password = newPassword;
        user.mustChangePassword = false;  // Clear the flag
        await user.save();

        // Invalidate all refresh tokens (force re-login on all devices)
        await user.invalidateAllTokens();

        res.json({
            success: true,
            message: 'Password changed successfully. Please login again on all devices.'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * POST /api/auth/force-change-password
 * Change password for users who must change it on first login
 * Does not require current password if mustChangePassword is true
 */
exports.forceChangePassword = async (req, res) => {
    try {
        const { newPassword } = req.body;

        if (!newPassword) {
            return res.status(400).json({
                success: false,
                error: 'New password is required'
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                error: 'New password must be at least 8 characters'
            });
        }

        // Get user
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Only allow this endpoint if mustChangePassword is true
        if (!user.mustChangePassword) {
            return res.status(403).json({
                success: false,
                error: 'Password change not required. Use /change-password instead.'
            });
        }

        // Update password and clear the flag
        user.password = newPassword;
        user.mustChangePassword = false;
        await user.save();

        // Invalidate all refresh tokens (force re-login)
        await user.invalidateAllTokens();

        res.json({
            success: true,
            message: 'Password changed successfully. Please login with your new password.'
        });
    } catch (error) {
        console.error('Force change password error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * GET /api/auth/sessions
 * Get all active sessions for current user
 */
exports.getSessions = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const sessions = user.getActiveSessions();

        res.json({
            success: true,
            sessions,
            count: sessions.length
        });
    } catch (error) {
        console.error('Get sessions error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * DELETE /api/auth/sessions/:index
 * Revoke a specific session
 */
exports.revokeSession = async (req, res) => {
    try {
        const sessionIndex = parseInt(req.params.index);

        if (isNaN(sessionIndex) || sessionIndex < 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid session index'
            });
        }

        const user = await User.findById(req.user.userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const revoked = await user.revokeSession(sessionIndex);

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
        console.error('Revoke session error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};
