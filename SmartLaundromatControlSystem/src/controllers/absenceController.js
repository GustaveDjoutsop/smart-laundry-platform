/**
 * Absence Controller
 * Handles absence request CRUD and approval workflow
 */

const Absence = require('../models/Absence');
const User = require('../models/User');
const { hasPermission } = require('../config/permissions');

// Valid absence types
const ABSENCE_TYPES = ['vacation', 'sick', 'personal', 'unpaid_leave', 'family_emergency', 'training'];

/**
 * GET /api/absences
 * Get absences (all users can see all absences)
 */
exports.getAbsences = async (req, res) => {
    try {
        const { startDate, endDate, employeeId, status, type, page = 1, limit = 50 } = req.query;

        // Build filters
        const filters = {};

        if (employeeId) {
            filters.employeeId = employeeId;
        }

        if (status) {
            filters.status = status;
        }

        if (type) {
            filters.type = type;
        }

        if (startDate) {
            filters.startDate = new Date(startDate);
        }

        if (endDate) {
            filters.endDate = new Date(endDate);
        }

        // Get absences
        const absences = await Absence.getAbsences(filters);

        // Paginate results
        const total = absences.length;
        const paginatedAbsences = absences.slice((page - 1) * limit, page * limit);

        res.json({
            success: true,
            absences: paginatedAbsences,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get absences error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * GET /api/absences/:id
 * Get a specific absence
 */
exports.getAbsence = async (req, res) => {
    try {
        const absence = await Absence.findById(req.params.id)
            .populate('employee', 'name email role')
            .populate('reviewedBy', 'name email')
            .populate('createdBy', 'name email');

        if (!absence) {
            return res.status(404).json({
                success: false,
                error: 'Absence not found'
            });
        }

        res.json({
            success: true,
            absence
        });
    } catch (error) {
        console.error('Get absence error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * POST /api/absences
 * Create a new absence request
 */
exports.createAbsence = async (req, res) => {
    try {
        const { employeeId, type, startDate, endDate, reason } = req.body;

        // Validate required fields
        if (!type || !startDate || !endDate) {
            return res.status(400).json({
                success: false,
                error: 'Type, start date, and end date are required'
            });
        }

        // Validate absence type
        if (!ABSENCE_TYPES.includes(type)) {
            return res.status(400).json({
                success: false,
                error: `Invalid absence type. Must be one of: ${ABSENCE_TYPES.join(', ')}`
            });
        }

        // Parse dates
        const start = new Date(startDate);
        const end = new Date(endDate);

        // Validate dates
        if (start > end) {
            return res.status(400).json({
                success: false,
                error: 'Start date must be before or equal to end date'
            });
        }

        // Determine target employee
        // Managers can create absences for other employees
        const canManage = hasPermission(req.user.role, 'absences:approve');
        const targetEmployeeId = canManage && employeeId ? employeeId : req.user.userId;

        // Check for overlapping absences
        const overlapping = await Absence.findOverlapping(targetEmployeeId, start, end);
        if (overlapping.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'This absence overlaps with an existing absence request',
                overlapping: overlapping.map(a => ({
                    id: a._id,
                    type: a.type,
                    startDate: a.startDate,
                    endDate: a.endDate,
                    status: a.status
                }))
            });
        }

        // Create absence
        const absence = await Absence.create({
            employee: targetEmployeeId,
            type,
            startDate: start,
            endDate: end,
            reason,
            createdBy: req.user.userId,
            // Auto-approve if created by manager for someone else
            status: canManage && employeeId && employeeId !== req.user.userId ? 'approved' : 'pending',
            reviewedBy: canManage && employeeId && employeeId !== req.user.userId ? req.user.userId : undefined,
            reviewedAt: canManage && employeeId && employeeId !== req.user.userId ? new Date() : undefined
        });

        await absence.populate('employee', 'name email role');
        await absence.populate('createdBy', 'name email');

        res.status(201).json({
            success: true,
            message: absence.status === 'approved'
                ? 'Absence created and approved'
                : 'Absence request submitted successfully',
            absence
        });
    } catch (error) {
        console.error('Create absence error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * PUT /api/absences/:id
 * Update an absence (own pending only, or managers can update any)
 */
exports.updateAbsence = async (req, res) => {
    try {
        const { type, startDate, endDate, reason } = req.body;

        const absence = await Absence.findById(req.params.id);
        if (!absence) {
            return res.status(404).json({
                success: false,
                error: 'Absence not found'
            });
        }

        const canManage = hasPermission(req.user.role, 'absences:approve');
        const isOwner = absence.employee.toString() === req.user.userId;

        // Only owner can update their own pending absences, or managers can update any
        if (!canManage && (!isOwner || absence.status !== 'pending')) {
            return res.status(403).json({
                success: false,
                error: 'You can only update your own pending absence requests'
            });
        }

        // Validate and update fields
        if (type) {
            if (!ABSENCE_TYPES.includes(type)) {
                return res.status(400).json({
                    success: false,
                    error: `Invalid absence type. Must be one of: ${ABSENCE_TYPES.join(', ')}`
                });
            }
            absence.type = type;
        }

        if (startDate) {
            absence.startDate = new Date(startDate);
        }

        if (endDate) {
            absence.endDate = new Date(endDate);
        }

        if (reason !== undefined) {
            absence.reason = reason;
        }

        // Validate dates
        if (absence.startDate > absence.endDate) {
            return res.status(400).json({
                success: false,
                error: 'Start date must be before or equal to end date'
            });
        }

        // Check for overlapping absences (excluding current one)
        const overlapping = await Absence.findOverlapping(
            absence.employee,
            absence.startDate,
            absence.endDate,
            absence._id
        );
        if (overlapping.length > 0) {
            return res.status(400).json({
                success: false,
                error: 'This absence overlaps with an existing absence request'
            });
        }

        await absence.save();
        await absence.populate('employee', 'name email role');

        res.json({
            success: true,
            message: 'Absence updated successfully',
            absence
        });
    } catch (error) {
        console.error('Update absence error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * DELETE /api/absences/:id
 * Cancel/delete an absence (own pending only, or managers can delete any)
 */
exports.deleteAbsence = async (req, res) => {
    try {
        const absence = await Absence.findById(req.params.id);
        if (!absence) {
            return res.status(404).json({
                success: false,
                error: 'Absence not found'
            });
        }

        const canManage = hasPermission(req.user.role, 'absences:approve');
        const isOwner = absence.employee.toString() === req.user.userId;

        // Only owner can delete their own pending absences, or managers can delete any
        if (!canManage && (!isOwner || absence.status !== 'pending')) {
            return res.status(403).json({
                success: false,
                error: 'You can only cancel your own pending absence requests'
            });
        }

        await Absence.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Absence cancelled successfully'
        });
    } catch (error) {
        console.error('Delete absence error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * POST /api/absences/:id/approve
 * Approve an absence (managers only)
 */
exports.approveAbsence = async (req, res) => {
    try {
        const { notes } = req.body;

        const absence = await Absence.findById(req.params.id);
        if (!absence) {
            return res.status(404).json({
                success: false,
                error: 'Absence not found'
            });
        }

        if (absence.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: `Cannot approve an absence that is already ${absence.status}`
            });
        }

        await absence.approve(req.user.userId, notes);
        await absence.populate('employee', 'name email role');
        await absence.populate('reviewedBy', 'name email');

        res.json({
            success: true,
            message: 'Absence approved successfully',
            absence
        });
    } catch (error) {
        console.error('Approve absence error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * POST /api/absences/:id/reject
 * Reject an absence (managers only)
 */
exports.rejectAbsence = async (req, res) => {
    try {
        const { notes } = req.body;

        if (!notes || notes.trim() === '') {
            return res.status(400).json({
                success: false,
                error: 'Rejection reason is required'
            });
        }

        const absence = await Absence.findById(req.params.id);
        if (!absence) {
            return res.status(404).json({
                success: false,
                error: 'Absence not found'
            });
        }

        if (absence.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: `Cannot reject an absence that is already ${absence.status}`
            });
        }

        await absence.reject(req.user.userId, notes);
        await absence.populate('employee', 'name email role');
        await absence.populate('reviewedBy', 'name email');

        res.json({
            success: true,
            message: 'Absence rejected',
            absence
        });
    } catch (error) {
        console.error('Reject absence error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * GET /api/absences/pending
 * Get pending absences count (for managers)
 */
exports.getPendingCount = async (req, res) => {
    try {
        const count = await Absence.countDocuments({ status: 'pending' });
        const pendingByEmployee = await Absence.getPendingCountByEmployee();

        res.json({
            success: true,
            count,
            byEmployee: pendingByEmployee
        });
    } catch (error) {
        console.error('Get pending count error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * GET /api/absences/summary/:employeeId
 * Get absence summary for an employee
 */
exports.getEmployeeSummary = async (req, res) => {
    try {
        const { employeeId } = req.params;
        const { year = new Date().getFullYear() } = req.query;

        const canViewAll = hasPermission(req.user.role, 'absences:approve');
        const targetEmployeeId = canViewAll ? employeeId : req.user.userId;

        // Verify employee exists
        const employee = await User.findById(targetEmployeeId).select('name email role');
        if (!employee) {
            return res.status(404).json({
                success: false,
                error: 'Employee not found'
            });
        }

        const summary = await Absence.getEmployeeSummary(targetEmployeeId, parseInt(year));

        res.json({
            success: true,
            employee,
            year: parseInt(year),
            summary
        });
    } catch (error) {
        console.error('Get employee summary error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * GET /api/absences/types
 * Get available absence types
 */
exports.getAbsenceTypes = async (req, res) => {
    res.json({
        success: true,
        types: ABSENCE_TYPES.map(type => ({
            value: type,
            label: type.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
        }))
    });
};
