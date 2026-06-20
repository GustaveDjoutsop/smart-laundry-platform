/**
 * Time Tracking Controller
 * Handles clock in/out and time entry management
 */

const TimeEntry = require('../models/TimeEntry');
const User = require('../models/User');
const { hasPermission } = require('../config/permissions');

/**
 * POST /api/timekeeping/clock-in
 * Clock in (manual or automatic)
 */
exports.clockIn = async (req, res) => {
    try {
        const { notes, method = 'manual' } = req.body;
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'Unknown';
        const userAgent = req.headers['user-agent'] || 'Unknown';

        // Check if already clocked in
        const { isClockedIn } = await TimeEntry.getClockStatus(req.user.userId);
        if (isClockedIn) {
            return res.status(400).json({
                success: false,
                error: 'Already clocked in. Please clock out first.'
            });
        }

        // Create clock-in entry
        const entry = await TimeEntry.create({
            employee: req.user.userId,
            type: 'clock_in',
            method,
            ipAddress,
            userAgent,
            notes
        });

        await entry.populate('employee', 'name email role');

        res.status(201).json({
            success: true,
            message: 'Clocked in successfully',
            entry
        });
    } catch (error) {
        console.error('Clock in error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during clock in'
        });
    }
};

/**
 * POST /api/timekeeping/clock-out
 * Clock out
 */
exports.clockOut = async (req, res) => {
    try {
        const { notes, method = 'manual' } = req.body;
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || 'Unknown';
        const userAgent = req.headers['user-agent'] || 'Unknown';

        // Check if clocked in
        const { isClockedIn, lastEntry } = await TimeEntry.getClockStatus(req.user.userId);
        if (!isClockedIn) {
            return res.status(400).json({
                success: false,
                error: 'Not clocked in. Please clock in first.'
            });
        }

        // Create clock-out entry
        const entry = await TimeEntry.create({
            employee: req.user.userId,
            type: 'clock_out',
            method,
            ipAddress,
            userAgent,
            notes
        });

        await entry.populate('employee', 'name email role');

        // Calculate session duration
        const durationMs = entry.timestamp.getTime() - lastEntry.timestamp.getTime();
        const totalMinutes = Math.floor(durationMs / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;

        res.status(201).json({
            success: true,
            message: 'Clocked out successfully',
            entry,
            sessionDuration: {
                hours,
                minutes,
                formatted: `${hours}h ${minutes}m`
            }
        });
    } catch (error) {
        console.error('Clock out error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error during clock out'
        });
    }
};

/**
 * GET /api/timekeeping/status
 * Get current clock status for the logged-in user
 */
exports.getStatus = async (req, res) => {
    try {
        const { isClockedIn, lastEntry } = await TimeEntry.getClockStatus(req.user.userId);

        let currentSessionDuration = null;
        if (isClockedIn && lastEntry) {
            const durationMs = Date.now() - lastEntry.timestamp.getTime();
            const totalMinutes = Math.floor(durationMs / 60000);
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            currentSessionDuration = {
                hours,
                minutes,
                formatted: `${hours}h ${minutes}m`,
                startTime: lastEntry.timestamp
            };
        }

        res.json({
            success: true,
            status: {
                isClockedIn,
                lastEntry,
                currentSessionDuration
            }
        });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * GET /api/timekeeping/entries
 * Get time entries (own for employees, all for managers)
 */
exports.getEntries = async (req, res) => {
    try {
        const { startDate, endDate, employeeId, page = 1, limit = 50 } = req.query;

        // Parse dates
        const start = startDate ? new Date(startDate) : new Date(new Date().setDate(new Date().getDate() - 30));
        const end = endDate ? new Date(endDate) : new Date();
        end.setHours(23, 59, 59, 999);

        // Determine which employee(s) to query
        let queryEmployeeId = null;
        const canViewAll = hasPermission(req.user.role, 'timekeeping:view_all');

        if (canViewAll && employeeId) {
            queryEmployeeId = employeeId;
        } else if (!canViewAll) {
            queryEmployeeId = req.user.userId;
        }

        // Build query
        const query = {
            timestamp: { $gte: start, $lte: end }
        };

        if (queryEmployeeId) {
            query.employee = queryEmployeeId;
        }

        // Get total count
        const total = await TimeEntry.countDocuments(query);

        // Get entries with pagination
        const entries = await TimeEntry.find(query)
            .populate('employee', 'name email role')
            .populate('createdBy', 'name email')
            .sort({ timestamp: -1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit));

        res.json({
            success: true,
            entries,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Get entries error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * POST /api/timekeeping/entries
 * Create a manual time entry (managers only)
 */
exports.createManualEntry = async (req, res) => {
    try {
        const { employeeId, type, timestamp, notes } = req.body;

        // Validate input
        if (!employeeId || !type || !timestamp) {
            return res.status(400).json({
                success: false,
                error: 'Employee ID, type, and timestamp are required'
            });
        }

        if (!['clock_in', 'clock_out'].includes(type)) {
            return res.status(400).json({
                success: false,
                error: 'Type must be clock_in or clock_out'
            });
        }

        // Verify employee exists
        const employee = await User.findById(employeeId);
        if (!employee) {
            return res.status(404).json({
                success: false,
                error: 'Employee not found'
            });
        }

        // Create manual entry
        const entry = await TimeEntry.create({
            employee: employeeId,
            type,
            timestamp: new Date(timestamp),
            method: 'manual',
            notes,
            createdBy: req.user.userId
        });

        await entry.populate('employee', 'name email role');
        await entry.populate('createdBy', 'name email');

        res.status(201).json({
            success: true,
            message: 'Manual entry created successfully',
            entry
        });
    } catch (error) {
        console.error('Create manual entry error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * GET /api/timekeeping/summary
 * Get working hours summary
 */
exports.getSummary = async (req, res) => {
    try {
        const { startDate, endDate, employeeId } = req.query;

        // Parse dates (default to current week)
        const now = new Date();
        const start = startDate
            ? new Date(startDate)
            : new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
        const end = endDate ? new Date(endDate) : new Date();
        end.setHours(23, 59, 59, 999);

        // Determine which employee to query
        const canViewAll = hasPermission(req.user.role, 'timekeeping:view_all');
        const targetEmployeeId = canViewAll && employeeId ? employeeId : req.user.userId;

        // Get summary
        const summary = await TimeEntry.calculateWorkingHours(targetEmployeeId, start, end);

        // Get employee info
        const employee = await User.findById(targetEmployeeId).select('name email role');

        // Get paired entries for the period
        const pairs = await TimeEntry.getPairedEntries(targetEmployeeId, start, end);

        res.json({
            success: true,
            summary: {
                employee,
                period: { start, end },
                totalHours: summary.totalHours,
                totalMinutes: summary.totalMinutes,
                remainingMinutes: summary.remainingMinutes,
                formattedDuration: summary.formattedDuration,
                sessions: pairs.map(p => ({
                    date: p.clockIn.timestamp,
                    clockIn: p.clockIn.timestamp,
                    clockOut: p.clockOut?.timestamp || null,
                    duration: p.durationFormatted,
                    isOpen: p.isOpen || false
                }))
            }
        });
    } catch (error) {
        console.error('Get summary error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * GET /api/timekeeping/today
 * Get today's entries for the logged-in user
 */
exports.getTodayEntries = async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const entries = await TimeEntry.find({
            employee: req.user.userId,
            timestamp: { $gte: today, $lt: tomorrow }
        }).sort({ timestamp: 1 });

        const pairs = await TimeEntry.getPairedEntries(req.user.userId, today, tomorrow);
        const summary = await TimeEntry.calculateWorkingHours(req.user.userId, today, tomorrow);

        res.json({
            success: true,
            today: {
                entries,
                sessions: pairs,
                totalHours: summary.formattedDuration
            }
        });
    } catch (error) {
        console.error('Get today entries error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};

/**
 * DELETE /api/timekeeping/entries/:id
 * Delete a time entry (managers only, for corrections)
 */
exports.deleteEntry = async (req, res) => {
    try {
        const { id } = req.params;

        const entry = await TimeEntry.findById(id);
        if (!entry) {
            return res.status(404).json({
                success: false,
                error: 'Entry not found'
            });
        }

        await TimeEntry.findByIdAndDelete(id);

        res.json({
            success: true,
            message: 'Entry deleted successfully'
        });
    } catch (error) {
        console.error('Delete entry error:', error);
        res.status(500).json({
            success: false,
            error: 'Server error'
        });
    }
};
