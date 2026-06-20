/**
 * Absence Routes
 * API endpoints for absence management
 */

const express = require('express');
const router = express.Router();
const absenceController = require('../controllers/absenceController');
const { authenticate, hasPermission } = require('../middleware/authMiddleware');

// ============================================
// All routes require authentication
// ============================================

/**
 * @route   GET /api/absences/types
 * @desc    Get available absence types
 * @access  Private
 */
router.get(
    '/types',
    authenticate,
    absenceController.getAbsenceTypes
);

/**
 * @route   GET /api/absences/pending
 * @desc    Get pending absences count (for managers)
 * @access  Private - requires absences:approve permission
 */
router.get(
    '/pending',
    authenticate,
    hasPermission('absences:approve'),
    absenceController.getPendingCount
);

/**
 * @route   GET /api/absences/summary/:employeeId
 * @desc    Get absence summary for an employee
 * @access  Private - requires absences:view_all permission
 */
router.get(
    '/summary/:employeeId',
    authenticate,
    hasPermission('absences:view_all'),
    absenceController.getEmployeeSummary
);

/**
 * @route   GET /api/absences
 * @desc    Get all absences (all employees can view all absences)
 * @access  Private - requires absences:view_all permission
 */
router.get(
    '/',
    authenticate,
    hasPermission('absences:view_all'),
    absenceController.getAbsences
);

/**
 * @route   POST /api/absences
 * @desc    Create a new absence request
 * @access  Private - requires absences:create_own permission
 */
router.post(
    '/',
    authenticate,
    hasPermission('absences:create_own'),
    absenceController.createAbsence
);

/**
 * @route   GET /api/absences/:id
 * @desc    Get a specific absence
 * @access  Private - requires absences:view_all permission
 */
router.get(
    '/:id',
    authenticate,
    hasPermission('absences:view_all'),
    absenceController.getAbsence
);

/**
 * @route   PUT /api/absences/:id
 * @desc    Update an absence (own pending only, or managers can update any)
 * @access  Private - requires absences:create_own permission
 */
router.put(
    '/:id',
    authenticate,
    hasPermission('absences:create_own'),
    absenceController.updateAbsence
);

/**
 * @route   DELETE /api/absences/:id
 * @desc    Cancel/delete an absence (own pending only, or managers can delete any)
 * @access  Private - requires absences:create_own permission
 */
router.delete(
    '/:id',
    authenticate,
    hasPermission('absences:create_own'),
    absenceController.deleteAbsence
);

/**
 * @route   POST /api/absences/:id/approve
 * @desc    Approve an absence (managers only)
 * @access  Private - requires absences:approve permission
 */
router.post(
    '/:id/approve',
    authenticate,
    hasPermission('absences:approve'),
    absenceController.approveAbsence
);

/**
 * @route   POST /api/absences/:id/reject
 * @desc    Reject an absence (managers only)
 * @access  Private - requires absences:approve permission
 */
router.post(
    '/:id/reject',
    authenticate,
    hasPermission('absences:approve'),
    absenceController.rejectAbsence
);

module.exports = router;
