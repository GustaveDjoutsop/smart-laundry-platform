/**
 * Timekeeping Routes
 * API endpoints for time tracking operations
 */

const express = require('express');
const router = express.Router();
const timeTrackingController = require('../controllers/timeTrackingController');
const { authenticate, hasPermission } = require('../middleware/authMiddleware');

// ============================================
// All routes require authentication
// ============================================

/**
 * @route   POST /api/timekeeping/clock-in
 * @desc    Clock in
 * @access  Private - requires timekeeping:clock permission
 */
router.post(
    '/clock-in',
    authenticate,
    hasPermission('timekeeping:clock'),
    timeTrackingController.clockIn
);

/**
 * @route   POST /api/timekeeping/clock-out
 * @desc    Clock out
 * @access  Private - requires timekeeping:clock permission
 */
router.post(
    '/clock-out',
    authenticate,
    hasPermission('timekeeping:clock'),
    timeTrackingController.clockOut
);

/**
 * @route   GET /api/timekeeping/status
 * @desc    Get current clock status
 * @access  Private - requires timekeeping:view_own permission
 */
router.get(
    '/status',
    authenticate,
    hasPermission('timekeeping:view_own'),
    timeTrackingController.getStatus
);

/**
 * @route   GET /api/timekeeping/entries
 * @desc    Get time entries (own for employees, all for managers)
 * @access  Private - requires timekeeping:view_own permission
 */
router.get(
    '/entries',
    authenticate,
    hasPermission('timekeeping:view_own'),
    timeTrackingController.getEntries
);

/**
 * @route   POST /api/timekeeping/entries
 * @desc    Create a manual time entry (managers only)
 * @access  Private - requires timekeeping:manage permission
 */
router.post(
    '/entries',
    authenticate,
    hasPermission('timekeeping:manage'),
    timeTrackingController.createManualEntry
);

/**
 * @route   GET /api/timekeeping/summary
 * @desc    Get working hours summary
 * @access  Private - requires timekeeping:view_own permission
 */
router.get(
    '/summary',
    authenticate,
    hasPermission('timekeeping:view_own'),
    timeTrackingController.getSummary
);

/**
 * @route   GET /api/timekeeping/today
 * @desc    Get today's entries for logged-in user
 * @access  Private - requires timekeeping:view_own permission
 */
router.get(
    '/today',
    authenticate,
    hasPermission('timekeeping:view_own'),
    timeTrackingController.getTodayEntries
);

/**
 * @route   DELETE /api/timekeeping/entries/:id
 * @desc    Delete a time entry (managers only)
 * @access  Private - requires timekeeping:manage permission
 */
router.delete(
    '/entries/:id',
    authenticate,
    hasPermission('timekeeping:manage'),
    timeTrackingController.deleteEntry
);

module.exports = router;
