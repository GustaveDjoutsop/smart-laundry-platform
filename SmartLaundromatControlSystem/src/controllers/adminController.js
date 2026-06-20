/**
 * Admin API Controller
 * Provides endpoints for the management dashboard
 */

const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Maintenance = require('../models/Maintenance');
const Expense = require('../models/Expense');
const Machine = require('../models/Machine');
const config = require('../config/env');
const { log } = require('../utils/logger');

// Helper to check DB connection
const isDbConnected = () => mongoose.connection.readyState === 1;

// Helper to format machine name
const formatMachineName = (machineId) => {
    return machineId.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
};

// Helper to get date range from period
const getDateRange = (period) => {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    switch (period) {
        case 'today':
            return { start: startOfToday, end: now };
        case 'week':
            const weekAgo = new Date(startOfToday);
            weekAgo.setDate(weekAgo.getDate() - 7);
            return { start: weekAgo, end: now };
        case 'month':
            const monthAgo = new Date(startOfToday);
            monthAgo.setMonth(monthAgo.getMonth() - 1);
            return { start: monthAgo, end: now };
        case 'year':
            const yearAgo = new Date(startOfToday);
            yearAgo.setFullYear(yearAgo.getFullYear() - 1);
            return { start: yearAgo, end: now };
        default:
            return { start: startOfToday, end: now };
    }
};

// ==================== DASHBOARD ====================

/**
 * GET /api/admin/dashboard/summary
 * Overview: revenue, machines, alerts
 */
exports.getDashboardSummary = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({ error: 'Database not connected' });
        }

        const today = new Date();
        const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

        // Get today's revenue
        const todayRevenue = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: startOfToday } } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        // Get month's revenue
        const monthRevenue = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: startOfMonth } } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        // Get machine status
        const allMachines = config.MACHINES.AVAILABLE_MACHINES;
        const activeCycles = await Transaction.find({
            cycleStatus: 'IN_PROGRESS',
            cycleEndsAt: { $gt: new Date() }
        });
        const machinesInUse = activeCycles.length;

        // Get active maintenance alerts
        const maintenanceAlerts = await Maintenance.countDocuments({
            isAlert: true,
            alertAcknowledged: false
        });

        // Get pending transactions (possible issues)
        const pendingOlderThan5Min = new Date();
        pendingOlderThan5Min.setMinutes(pendingOlderThan5Min.getMinutes() - 5);
        const stalePending = await Transaction.countDocuments({
            status: 'PENDING',
            createdAt: { $lt: pendingOlderThan5Min }
        });

        // Get average rating this month
        const avgRating = await Transaction.aggregate([
            { $match: { 'feedback.rating': { $exists: true }, createdAt: { $gte: startOfMonth } } },
            { $group: { _id: null, avg: { $avg: '$feedback.rating' }, count: { $sum: 1 } } }
        ]);

        res.json({
            revenue: {
                today: todayRevenue[0]?.total || 0,
                todayTransactions: todayRevenue[0]?.count || 0,
                month: monthRevenue[0]?.total || 0,
                monthTransactions: monthRevenue[0]?.count || 0
            },
            machines: {
                total: allMachines.length,
                inUse: machinesInUse,
                available: allMachines.length - machinesInUse
            },
            alerts: {
                maintenance: maintenanceAlerts,
                stalePending: stalePending,
                total: maintenanceAlerts + stalePending
            },
            feedback: {
                averageRating: avgRating[0]?.avg?.toFixed(1) || null,
                totalReviews: avgRating[0]?.count || 0
            }
        });
    } catch (error) {
        log.error('Dashboard summary error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/dashboard/stats
 * Stats by period (today/week/month)
 */
exports.getDashboardStats = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({ error: 'Database not connected' });
        }

        const { period = 'week' } = req.query;
        const { start, end } = getDateRange(period);

        // Revenue over time
        const revenueByDay = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    revenue: { $sum: '$amount' },
                    transactions: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Transactions by status
        const transactionsByStatus = await Transaction.aggregate([
            { $match: { createdAt: { $gte: start, $lte: end } } },
            { $group: { _id: '$status', count: { $sum: 1 } } }
        ]);

        // Usage by hour (for heatmap)
        const usageByHour = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: { $hour: '$createdAt' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            period,
            dateRange: { start, end },
            revenueByDay,
            transactionsByStatus: transactionsByStatus.reduce((acc, item) => {
                acc[item._id] = item.count;
                return acc;
            }, {}),
            usageByHour: usageByHour.map(h => ({ hour: h._id, count: h.count }))
        });
    } catch (error) {
        log.error('Dashboard stats error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// ==================== MACHINES ====================

// Helper to map machine DB status to frontend status
const mapMachineStatus = (dbStatus, hasActiveCycle, hasPendingPayment) => {
    // If there's an active transaction cycle, machine is in use
    if (hasActiveCycle) return 'in_use';
    // If there's a pending payment, machine is reserved
    if (hasPendingPayment) return 'reserved';

    // Map DB status to frontend status
    switch (dbStatus) {
        case 'RUNNING':
            return 'in_use';
        case 'FINISHED':
            return 'completing'; // Cycle finished, waiting for customer
        case 'ERROR':
            return 'error';
        case 'MAINTENANCE':
            return 'maintenance';
        case 'OFFLINE':
            return 'offline';
        case 'IDLE':
        case 'PAUSED':
        default:
            return 'available';
    }
};

/**
 * GET /api/admin/machines
 * All machines with status from Machine collection + Transaction data
 */
exports.getMachines = async (req, res) => {
    try {
        // Get all machines from the Machine collection
        const machineRecords = await Machine.find({}).sort({ type: 1, machineId: 1 });

        // Fallback to config if no machines in DB
        const machineIds = machineRecords.length > 0
            ? machineRecords.map(m => m.machineId)
            : config.MACHINES.AVAILABLE_MACHINES;

        // Get active cycles from transactions
        const activeCycles = await Transaction.find({
            cycleStatus: 'IN_PROGRESS',
            cycleEndsAt: { $gt: new Date() }
        });

        // Get pending payments (reserved) - within last 5 minutes
        const pendingTimeout = new Date();
        pendingTimeout.setMinutes(pendingTimeout.getMinutes() - 5);
        const pendingPayments = await Transaction.find({
            status: 'PENDING',
            createdAt: { $gt: pendingTimeout }
        });

        // Get today's stats per machine
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const todayStats = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: startOfToday } } },
            {
                $group: {
                    _id: '$machineId',
                    revenue: { $sum: '$amount' },
                    cycles: { $sum: 1 }
                }
            }
        ]);

        // Get this month's stats per machine
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const monthStats = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: startOfMonth } } },
            {
                $group: {
                    _id: '$machineId',
                    revenue: { $sum: '$amount' },
                    cycles: { $sum: 1 }
                }
            }
        ]);

        // Create lookup maps
        const todayStatsMap = todayStats.reduce((acc, item) => {
            acc[item._id] = item;
            return acc;
        }, {});

        const monthStatsMap = monthStats.reduce((acc, item) => {
            acc[item._id] = item;
            return acc;
        }, {});

        const machineRecordMap = machineRecords.reduce((acc, m) => {
            acc[m.machineId] = m;
            return acc;
        }, {});

        // Build machine list
        const machines = machineIds.map(machineId => {
            const machineRecord = machineRecordMap[machineId];
            const activeCycle = activeCycles.find(c => c.machineId === machineId);
            const pendingPayment = pendingPayments.find(p => p.machineId === machineId);
            const todayStat = todayStatsMap[machineId] || { revenue: 0, cycles: 0 };
            const monthStat = monthStatsMap[machineId] || { revenue: 0, cycles: 0 };

            // Get status from transaction or machine record
            const dbStatus = machineRecord?.status || 'IDLE';
            const status = mapMachineStatus(dbStatus, !!activeCycle, !!pendingPayment);

            // Calculate remaining minutes
            let remainingMinutes = 0;
            let currentProgram = null;
            if (activeCycle) {
                remainingMinutes = Math.max(0, Math.ceil((activeCycle.cycleEndsAt - new Date()) / (1000 * 60)));
                currentProgram = activeCycle.cycleDuration ? `${activeCycle.cycleDuration} min` : null;
            } else if (machineRecord?.currentCycle?.remainingTime > 0) {
                remainingMinutes = Math.ceil(machineRecord.currentCycle.remainingTime);
                currentProgram = machineRecord.currentCycle.type !== 'none' ? machineRecord.currentCycle.type : null;
            }

            // Get maintenance data
            const totalCycles = machineRecord?.maintenance?.totalCycles || 0;
            const cyclesSinceMaintenance = machineRecord?.maintenance?.cyclesSinceService || 0;
            const lastMaintenance = machineRecord?.maintenance?.lastServiceDate || null;

            // Calculate utilization rate (approximate: cycles per day over last 30 days)
            // Assuming 8 hours operation per day, ~16 cycles max per day per machine
            const daysInMonth = new Date().getDate();
            const avgCyclesPerDay = daysInMonth > 0 ? monthStat.cycles / daysInMonth : 0;
            const maxCyclesPerDay = 16; // Approximate max
            const utilizationRate = Math.min(100, Math.round((avgCyclesPerDay / maxCyclesPerDay) * 100));

            return {
                id: machineId,
                name: formatMachineName(machineId),
                type: machineRecord?.type || (machineId.startsWith('washer') ? 'washer' : 'dryer'),
                status,

                // Current cycle info
                currentProgram,
                remainingMinutes,
                timeRemaining: remainingMinutes,

                // Today's stats
                todayRevenue: todayStat.revenue,
                todayCycles: todayStat.cycles,

                // Statistics
                totalCycles,
                cyclesThisMonth: monthStat.cycles,
                cyclesToday: todayStat.cycles,

                // Health/Maintenance
                lastMaintenance,
                cyclesSinceMaintenance,
                errorCount: machineRecord?.errorCode ? 1 : 0,
                lastError: machineRecord?.errorCode ? {
                    code: machineRecord.errorCode,
                    message: machineRecord.errorMessage,
                    date: machineRecord.updatedAt
                } : null,

                // Utilization
                utilizationRate,
                averageCyclesPerDay: Math.round(avgCyclesPerDay * 10) / 10
            };
        });

        res.json({
            machines,
            summary: {
                total: machines.length,
                available: machines.filter(m => m.status === 'available').length,
                inUse: machines.filter(m => m.status === 'in_use').length,
                reserved: machines.filter(m => m.status === 'reserved').length
            }
        });
    } catch (error) {
        log.error('Get machines error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/machines/:id
 * Single machine details
 */
exports.getMachineById = async (req, res) => {
    try {
        const { id } = req.params;
        const allMachines = config.MACHINES.AVAILABLE_MACHINES;

        if (!allMachines.includes(id)) {
            return res.status(404).json({ error: 'Machine not found' });
        }

        // Get current status
        const activeCycle = await Transaction.findOne({
            machineId: id,
            cycleStatus: 'IN_PROGRESS',
            cycleEndsAt: { $gt: new Date() }
        });

        // Get recent transactions
        const recentTransactions = await Transaction.find({ machineId: id })
            .sort({ createdAt: -1 })
            .limit(10);

        // Get statistics
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const monthStats = await Transaction.aggregate([
            { $match: { machineId: id, status: 'SUCCESSFUL', createdAt: { $gte: startOfMonth } } },
            {
                $group: {
                    _id: null,
                    revenue: { $sum: '$amount' },
                    cycles: { $sum: 1 },
                    avgCycleDuration: { $avg: '$cycleDuration' }
                }
            }
        ]);

        // Get maintenance history
        const maintenanceHistory = await Maintenance.find({ machineId: id })
            .sort({ createdAt: -1 })
            .limit(5);

        // Get average rating
        const avgRating = await Transaction.aggregate([
            { $match: { machineId: id, 'feedback.rating': { $exists: true } } },
            { $group: { _id: null, avg: { $avg: '$feedback.rating' }, count: { $sum: 1 } } }
        ]);

        res.json({
            id,
            name: formatMachineName(id),
            type: id.startsWith('washer') ? 'washer' : 'dryer',
            status: activeCycle ? 'in_use' : 'available',
            currentCycle: activeCycle ? {
                startedAt: activeCycle.cycleStartedAt,
                endsAt: activeCycle.cycleEndsAt,
                remainingMinutes: Math.ceil((activeCycle.cycleEndsAt - new Date()) / (1000 * 60)),
                customerPhone: activeCycle.phoneNumber?.slice(-4) // Last 4 digits only
            } : null,
            monthStats: monthStats[0] || { revenue: 0, cycles: 0, avgCycleDuration: 0 },
            rating: {
                average: avgRating[0]?.avg?.toFixed(1) || null,
                totalReviews: avgRating[0]?.count || 0
            },
            recentTransactions: recentTransactions.map(t => ({
                id: t._id,
                date: t.createdAt,
                amount: t.amount,
                status: t.status,
                cycleDuration: t.cycleDuration
            })),
            maintenanceHistory
        });
    } catch (error) {
        log.error('Get machine by ID error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/machines/:id/history
 * Usage history for a machine
 */
exports.getMachineHistory = async (req, res) => {
    try {
        const { id } = req.params;
        const { period = 'month', page = 1, limit = 20 } = req.query;
        const { start, end } = getDateRange(period);

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const transactions = await Transaction.find({
            machineId: id,
            createdAt: { $gte: start, $lte: end }
        })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Transaction.countDocuments({
            machineId: id,
            createdAt: { $gte: start, $lte: end }
        });

        // Daily usage stats
        const dailyStats = await Transaction.aggregate([
            { $match: { machineId: id, status: 'SUCCESSFUL', createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    revenue: { $sum: '$amount' },
                    cycles: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            machineId: id,
            period,
            dateRange: { start, end },
            transactions,
            dailyStats,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        log.error('Get machine history error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// ==================== TRANSACTIONS ====================

/**
 * GET /api/admin/transactions
 * Paginated list with filters
 */
exports.getTransactions = async (req, res) => {
    try {
        const {
            page = 1,
            limit = 20,
            status,
            machineId,
            startDate,
            endDate,
            search
        } = req.query;

        const query = {};

        if (status) query.status = status;
        if (machineId) query.machineId = machineId;
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }
        if (search) {
            // Sanitize search input to prevent NoSQL injection via regex
            // Escape special regex characters: . * + ? ^ $ { } ( ) | [ ] \
            const sanitizedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            query.$or = [
                { phoneNumber: { $regex: sanitizedSearch, $options: 'i' } },
                { externalReference: { $regex: sanitizedSearch, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const transactions = await Transaction.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Transaction.countDocuments(query);

        res.json({
            transactions: transactions.map(t => ({
                id: t._id,
                externalReference: t.externalReference,
                phoneNumber: t.phoneNumber,
                machineId: t.machineId,
                machineName: formatMachineName(t.machineId),
                amount: t.amount,
                status: t.status,
                cycleStatus: t.cycleStatus,
                cycleDuration: t.cycleDuration,
                paymentProvider: t.paymentProvider,
                createdAt: t.createdAt,
                feedback: t.feedback
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        log.error('Get transactions error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/transactions/:id
 * Single transaction details
 */
exports.getTransactionById = async (req, res) => {
    try {
        const { id } = req.params;
        const transaction = await Transaction.findById(id);

        if (!transaction) {
            return res.status(404).json({ error: 'Transaction not found' });
        }

        res.json({
            ...transaction.toObject(),
            machineName: formatMachineName(transaction.machineId)
        });
    } catch (error) {
        log.error('Get transaction by ID error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/transactions/export
 * Export CSV/Excel
 */
exports.exportTransactions = async (req, res) => {
    try {
        const { startDate, endDate, format = 'csv' } = req.query;

        const query = { status: 'SUCCESSFUL' };
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const transactions = await Transaction.find(query).sort({ createdAt: -1 });

        if (format === 'csv') {
            const headers = ['Date', 'Reference', 'Phone', 'Machine', 'Amount', 'Duration', 'Provider', 'Status'];
            const rows = transactions.map(t => [
                t.createdAt.toISOString(),
                t.externalReference,
                t.phoneNumber,
                t.machineId,
                t.amount,
                t.cycleDuration,
                t.paymentProvider,
                t.status
            ]);

            const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=transactions_${new Date().toISOString().split('T')[0]}.csv`);
            res.send(csv);
        } else {
            res.json({ transactions });
        }
    } catch (error) {
        log.error('Export transactions error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// ==================== REVENUE ====================

/**
 * GET /api/admin/revenue/summary
 * Revenue by period
 */
exports.getRevenueSummary = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const { start, end } = getDateRange(period);

        const revenue = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: null,
                    total: { $sum: '$amount' },
                    count: { $sum: 1 },
                    avgTransaction: { $avg: '$amount' }
                }
            }
        ]);

        // Compare with previous period
        const periodLength = end - start;
        const prevStart = new Date(start.getTime() - periodLength);
        const prevEnd = start;

        const prevRevenue = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: prevStart, $lt: prevEnd } } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        const current = revenue[0] || { total: 0, count: 0, avgTransaction: 0 };
        const previous = prevRevenue[0] || { total: 0, count: 0 };

        const growthPercent = previous.total > 0
            ? ((current.total - previous.total) / previous.total * 100).toFixed(1)
            : null;

        res.json({
            period,
            dateRange: { start, end },
            current: {
                total: current.total,
                transactions: current.count,
                avgTransaction: Math.round(current.avgTransaction || 0)
            },
            previous: {
                total: previous.total,
                transactions: previous.count
            },
            growth: {
                amount: current.total - previous.total,
                percent: growthPercent
            }
        });
    } catch (error) {
        log.error('Revenue summary error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/revenue/by-provider
 * Breakdown by CamPay/MTN/Orange/Wave
 */
exports.getRevenueByProvider = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const { start, end } = getDateRange(period);

        const byProvider = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: '$paymentProvider',
                    revenue: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const total = byProvider.reduce((sum, p) => sum + p.revenue, 0);

        res.json({
            period,
            dateRange: { start, end },
            providers: byProvider.map(p => ({
                provider: p._id || 'unknown',
                revenue: p.revenue,
                transactions: p.count,
                percentage: total > 0 ? ((p.revenue / total) * 100).toFixed(1) : 0
            })),
            total
        });
    } catch (error) {
        log.error('Revenue by provider error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/revenue/by-program
 * Breakdown by Express/Standard/Intensive
 */
exports.getRevenueByProgram = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const { start, end } = getDateRange(period);

        const byDuration = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: '$cycleDuration',
                    revenue: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const total = byDuration.reduce((sum, p) => sum + p.revenue, 0);

        // Map durations to program names
        const programNames = {
            30: 'Express (30 min)',
            45: 'Standard (45 min)',
            60: 'Intensive (60 min)'
        };

        res.json({
            period,
            dateRange: { start, end },
            programs: byDuration.map(p => ({
                duration: p._id,
                name: programNames[p._id] || `${p._id} min`,
                revenue: p.revenue,
                transactions: p.count,
                percentage: total > 0 ? ((p.revenue / total) * 100).toFixed(1) : 0
            })),
            total
        });
    } catch (error) {
        log.error('Revenue by program error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/revenue/by-machine
 * Revenue per machine
 */
exports.getRevenueByMachine = async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        const { start, end } = getDateRange(period);

        const byMachine = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: start, $lte: end } } },
            {
                $group: {
                    _id: '$machineId',
                    revenue: { $sum: '$amount' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { revenue: -1 } }
        ]);

        const total = byMachine.reduce((sum, m) => sum + m.revenue, 0);

        res.json({
            period,
            dateRange: { start, end },
            machines: byMachine.map(m => ({
                machineId: m._id,
                name: formatMachineName(m._id),
                type: m._id?.startsWith('washer') ? 'washer' : 'dryer',
                revenue: m.revenue,
                cycles: m.count,
                percentage: total > 0 ? ((m.revenue / total) * 100).toFixed(1) : 0
            })),
            total
        });
    } catch (error) {
        log.error('Revenue by machine error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/revenue/trends
 * Historical trends
 */
exports.getRevenueTrends = async (req, res) => {
    try {
        const { months = 6 } = req.query;
        const startDate = new Date();
        startDate.setMonth(startDate.getMonth() - parseInt(months));
        startDate.setDate(1);
        startDate.setHours(0, 0, 0, 0);

        const trends = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: startDate } } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
                    revenue: { $sum: '$amount' },
                    transactions: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        res.json({
            months: parseInt(months),
            trends: trends.map(t => ({
                month: t._id,
                revenue: t.revenue,
                transactions: t.transactions
            }))
        });
    } catch (error) {
        log.error('Revenue trends error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// ==================== MAINTENANCE ====================

/**
 * GET /api/admin/maintenance/alerts
 * Active maintenance alerts
 */
exports.getMaintenanceAlerts = async (req, res) => {
    try {
        const alerts = await Maintenance.find({
            isAlert: true,
            alertAcknowledged: false
        }).sort({ priority: -1, createdAt: -1 });

        res.json({ alerts });
    } catch (error) {
        log.error('Get maintenance alerts error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/maintenance/history
 * Maintenance logs
 */
exports.getMaintenanceHistory = async (req, res) => {
    try {
        const { page = 1, limit = 20, machineId, status } = req.query;
        const query = {};

        if (machineId) query.machineId = machineId;
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const maintenance = await Maintenance.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Maintenance.countDocuments(query);

        res.json({
            maintenance,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        log.error('Get maintenance history error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/admin/maintenance/log
 * Record new maintenance
 */
exports.createMaintenanceLog = async (req, res) => {
    try {
        const { machineId, type, description, priority, notes, cost, performedBy } = req.body;

        if (!machineId || !type || !description) {
            return res.status(400).json({ error: 'machineId, type, and description are required' });
        }

        const maintenance = await Maintenance.create({
            machineId,
            type,
            description,
            priority: priority || 'medium',
            notes,
            cost: cost || 0,
            performedBy,
            status: 'completed',
            completedDate: new Date()
        });

        res.status(201).json({ maintenance });
    } catch (error) {
        log.error('Create maintenance log error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// ==================== REPORTS ====================

/**
 * GET /api/admin/reports/daily/:date
 * Daily report
 */
exports.getDailyReport = async (req, res) => {
    try {
        const { date } = req.params;
        const reportDate = new Date(date);
        const startOfDay = new Date(reportDate.setHours(0, 0, 0, 0));
        const endOfDay = new Date(reportDate.setHours(23, 59, 59, 999));

        // Revenue
        const revenue = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: startOfDay, $lte: endOfDay } } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        // By machine
        const byMachine = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: startOfDay, $lte: endOfDay } } },
            { $group: { _id: '$machineId', revenue: { $sum: '$amount' }, cycles: { $sum: 1 } } }
        ]);

        // By hour
        const byHour = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: startOfDay, $lte: endOfDay } } },
            { $group: { _id: { $hour: '$createdAt' }, revenue: { $sum: '$amount' }, cycles: { $sum: 1 } } },
            { $sort: { _id: 1 } }
        ]);

        // Failed transactions
        const failed = await Transaction.countDocuments({
            status: 'FAILED',
            createdAt: { $gte: startOfDay, $lte: endOfDay }
        });

        // Expenses for the day
        const expenses = await Expense.aggregate([
            { $match: { date: { $gte: startOfDay, $lte: endOfDay } } },
            { $group: { _id: null, total: { $sum: '$amount' } } }
        ]);

        res.json({
            date: date,
            revenue: {
                total: revenue[0]?.total || 0,
                transactions: revenue[0]?.count || 0
            },
            expenses: expenses[0]?.total || 0,
            profit: (revenue[0]?.total || 0) - (expenses[0]?.total || 0),
            failedTransactions: failed,
            byMachine: byMachine.map(m => ({
                machineId: m._id,
                name: formatMachineName(m._id),
                revenue: m.revenue,
                cycles: m.cycles
            })),
            byHour: byHour.map(h => ({ hour: h._id, revenue: h.revenue, cycles: h.cycles }))
        });
    } catch (error) {
        log.error('Daily report error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/reports/monthly/:year/:month
 * Monthly P&L
 */
exports.getMonthlyReport = async (req, res) => {
    try {
        const { year, month } = req.params;
        const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
        const endOfMonth = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59, 999);

        // Revenue
        const revenue = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        // Daily breakdown
        const dailyRevenue = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
            {
                $group: {
                    _id: { $dayOfMonth: '$createdAt' },
                    revenue: { $sum: '$amount' },
                    transactions: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Expenses by category
        const expensesByCategory = await Expense.aggregate([
            { $match: { date: { $gte: startOfMonth, $lte: endOfMonth } } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } }
        ]);

        const totalExpenses = expensesByCategory.reduce((sum, e) => sum + e.total, 0);
        const totalRevenue = revenue[0]?.total || 0;

        res.json({
            year: parseInt(year),
            month: parseInt(month),
            dateRange: { start: startOfMonth, end: endOfMonth },
            revenue: {
                total: totalRevenue,
                transactions: revenue[0]?.count || 0
            },
            expenses: {
                total: totalExpenses,
                byCategory: expensesByCategory.map(e => ({
                    category: e._id,
                    amount: e.total
                }))
            },
            profit: totalRevenue - totalExpenses,
            profitMargin: totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue * 100).toFixed(1) : 0,
            dailyRevenue: dailyRevenue.map(d => ({ day: d._id, revenue: d.revenue, transactions: d.transactions }))
        });
    } catch (error) {
        log.error('Monthly report error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/admin/reports/export
 * Generate PDF/Excel
 */
exports.exportReport = async (req, res) => {
    try {
        const { type, startDate, endDate, format = 'json' } = req.body;

        // For now, return JSON - PDF/Excel generation would require additional libraries
        const start = new Date(startDate);
        const end = new Date(endDate);

        const revenue = await Transaction.aggregate([
            { $match: { status: 'SUCCESSFUL', createdAt: { $gte: start, $lte: end } } },
            { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
        ]);

        const expenses = await Expense.aggregate([
            { $match: { date: { $gte: start, $lte: end } } },
            { $group: { _id: '$category', total: { $sum: '$amount' } } }
        ]);

        res.json({
            reportType: type,
            dateRange: { start, end },
            format,
            data: {
                revenue: revenue[0] || { total: 0, count: 0 },
                expenses,
                totalExpenses: expenses.reduce((sum, e) => sum + e.total, 0)
            }
        });
    } catch (error) {
        log.error('Export report error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// ==================== EXPENSES ====================

/**
 * GET /api/admin/expenses
 * Manage expenses
 */
exports.getExpenses = async (req, res) => {
    try {
        const { page = 1, limit = 20, category, startDate, endDate } = req.query;
        const query = {};

        if (category) query.category = category;
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const expenses = await Expense.find(query)
            .sort({ date: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Expense.countDocuments(query);

        // Summary by category
        const summary = await Expense.aggregate([
            { $match: query },
            { $group: { _id: '$category', total: { $sum: '$amount' } } }
        ]);

        res.json({
            expenses,
            summary: summary.reduce((acc, s) => {
                acc[s._id] = s.total;
                return acc;
            }, {}),
            grandTotal: summary.reduce((sum, s) => sum + s.total, 0),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        log.error('Get expenses error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * POST /api/admin/expenses
 * Create expense
 */
exports.createExpense = async (req, res) => {
    try {
        const { category, description, amount, date, paymentMethod, vendor, receiptNumber, notes } = req.body;

        if (!category || !description || !amount || !date) {
            return res.status(400).json({ error: 'category, description, amount, and date are required' });
        }

        const expense = await Expense.create({
            category,
            description,
            amount,
            date: new Date(date),
            paymentMethod: paymentMethod || 'cash',
            vendor,
            receiptNumber,
            notes
        });

        res.status(201).json({ expense });
    } catch (error) {
        log.error('Create expense error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// ==================== RECONCILIATION ====================

/**
 * POST /api/admin/reconciliation/run
 * Run payment reconciliation
 */
exports.runReconciliation = async (req, res) => {
    try {
        const { startDate, endDate } = req.body;

        const start = startDate ? new Date(startDate) : new Date(new Date().setHours(0, 0, 0, 0));
        const end = endDate ? new Date(endDate) : new Date();

        // Find all transactions in date range
        const transactions = await Transaction.find({
            createdAt: { $gte: start, $lte: end }
        });

        // Group by status
        const byStatus = {
            SUCCESSFUL: transactions.filter(t => t.status === 'SUCCESSFUL'),
            FAILED: transactions.filter(t => t.status === 'FAILED'),
            PENDING: transactions.filter(t => t.status === 'PENDING')
        };

        // Check for discrepancies
        const discrepancies = [];

        // 1. Pending transactions older than 10 minutes (should have been resolved)
        const tenMinutesAgo = new Date();
        tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

        const stalePending = byStatus.PENDING.filter(t => t.createdAt < tenMinutesAgo);
        stalePending.forEach(t => {
            discrepancies.push({
                type: 'stale_pending',
                transactionId: t._id,
                externalReference: t.externalReference,
                amount: t.amount,
                createdAt: t.createdAt,
                description: 'Transaction pending for more than 10 minutes'
            });
        });

        // 2. Successful payments without cycle started
        const noCycleStarted = byStatus.SUCCESSFUL.filter(t => t.cycleStatus === 'NOT_STARTED');
        noCycleStarted.forEach(t => {
            discrepancies.push({
                type: 'no_cycle_started',
                transactionId: t._id,
                externalReference: t.externalReference,
                amount: t.amount,
                createdAt: t.createdAt,
                description: 'Payment successful but cycle never started'
            });
        });

        // Summary
        const totalRevenue = byStatus.SUCCESSFUL.reduce((sum, t) => sum + t.amount, 0);
        const failedAmount = byStatus.FAILED.reduce((sum, t) => sum + t.amount, 0);

        res.json({
            dateRange: { start, end },
            summary: {
                totalTransactions: transactions.length,
                successful: byStatus.SUCCESSFUL.length,
                failed: byStatus.FAILED.length,
                pending: byStatus.PENDING.length,
                totalRevenue,
                failedAmount
            },
            discrepancies,
            discrepancyCount: discrepancies.length,
            reconciliationStatus: discrepancies.length === 0 ? 'OK' : 'NEEDS_ATTENTION'
        });
    } catch (error) {
        log.error('Reconciliation error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// ==================== FEEDBACK ====================

/**
 * GET /api/admin/feedback
 * Customer feedback/reviews with filters
 */
exports.getFeedback = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({ error: 'Database not connected' });
        }

        const {
            page = 1,
            limit = 20,
            rating,
            machineId,
            startDate,
            endDate,
            hasComment
        } = req.query;

        // Build query for transactions with feedback
        const query = { 'feedback.rating': { $exists: true } };

        if (rating) {
            query['feedback.rating'] = parseInt(rating);
        }
        if (machineId) {
            query.machineId = machineId;
        }
        if (startDate || endDate) {
            query['feedback.submittedAt'] = {};
            if (startDate) query['feedback.submittedAt'].$gte = new Date(startDate);
            if (endDate) query['feedback.submittedAt'].$lte = new Date(endDate);
        }
        if (hasComment === 'true') {
            query['feedback.comment'] = { $exists: true, $ne: '' };
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const transactions = await Transaction.find(query)
            .sort({ 'feedback.submittedAt': -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Transaction.countDocuments(query);

        // Get rating distribution
        const distribution = await Transaction.aggregate([
            { $match: { 'feedback.rating': { $exists: true } } },
            { $group: { _id: '$feedback.rating', count: { $sum: 1 } } },
            { $sort: { _id: -1 } }
        ]);

        // Get overall stats
        const stats = await Transaction.aggregate([
            { $match: { 'feedback.rating': { $exists: true } } },
            {
                $group: {
                    _id: null,
                    averageRating: { $avg: '$feedback.rating' },
                    totalReviews: { $sum: 1 },
                    withComments: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $ifNull: ['$feedback.comment', false] }, // Field exists and not null
                                        { $ne: ['$feedback.comment', ''] },        // Not empty string
                                        { $gt: [{ $strLenCP: { $ifNull: ['$feedback.comment', ''] } }, 0] } // Has actual content
                                    ]
                                },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        res.json({
            feedback: transactions.map(t => ({
                id: t._id,
                transactionId: t.externalReference,
                machineId: t.machineId,
                machineName: formatMachineName(t.machineId),
                machineType: t.machineId.startsWith('washer') ? 'washer' : 'dryer',
                customerPhone: t.phoneNumber ? `***${t.phoneNumber.slice(-4)}` : null,
                rating: t.feedback.rating,
                comment: t.feedback.comment || null,
                submittedAt: t.feedback.submittedAt,
                transactionDate: t.createdAt,
                amount: t.amount,
                cycleDuration: t.cycleDuration,
                staffAlertSent: t.feedback.staffAlertSent || false
            })),
            stats: {
                averageRating: stats[0]?.averageRating?.toFixed(1) || null,
                totalReviews: stats[0]?.totalReviews || 0,
                withComments: stats[0]?.withComments || 0
            },
            distribution: [5, 4, 3, 2, 1].map(star => ({
                rating: star,
                count: distribution.find(d => d._id === star)?.count || 0
            })),
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total,
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        log.error('Get feedback error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/feedback/analytics
 * Feedback trends and analytics
 */
exports.getFeedbackAnalytics = async (req, res) => {
    try {
        if (!isDbConnected()) {
            return res.status(503).json({ error: 'Database not connected' });
        }

        const { period = 'month' } = req.query;
        const { start, end } = getDateRange(period);

        // Rating trend over time (by day)
        const ratingTrend = await Transaction.aggregate([
            {
                $match: {
                    'feedback.rating': { $exists: true },
                    'feedback.submittedAt': { $gte: start, $lte: end }
                }
            },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$feedback.submittedAt' } },
                    averageRating: { $avg: '$feedback.rating' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        // Rating by machine
        const ratingByMachine = await Transaction.aggregate([
            { $match: { 'feedback.rating': { $exists: true } } },
            {
                $group: {
                    _id: '$machineId',
                    averageRating: { $avg: '$feedback.rating' },
                    totalReviews: { $sum: 1 }
                }
            },
            { $sort: { averageRating: -1 } }
        ]);

        // Low rating alerts (1-2 stars in the period)
        const lowRatingAlerts = await Transaction.find({
            'feedback.rating': { $lte: 2 },
            'feedback.submittedAt': { $gte: start, $lte: end }
        })
            .sort({ 'feedback.submittedAt': -1 })
            .limit(10);

        res.json({
            period,
            dateRange: { start, end },
            trend: ratingTrend.map(t => ({
                date: t._id,
                averageRating: parseFloat(t.averageRating.toFixed(1)),
                count: t.count
            })),
            byMachine: ratingByMachine.map(m => ({
                machineId: m._id,
                name: formatMachineName(m._id),
                type: m._id?.startsWith('washer') ? 'washer' : 'dryer',
                averageRating: parseFloat(m.averageRating.toFixed(1)),
                totalReviews: m.totalReviews
            })),
            lowRatingAlerts: lowRatingAlerts.map(t => ({
                id: t._id,
                machineId: t.machineId,
                machineName: formatMachineName(t.machineId),
                rating: t.feedback.rating,
                comment: t.feedback.comment,
                submittedAt: t.feedback.submittedAt,
                customerPhone: t.phoneNumber ? `***${t.phoneNumber.slice(-4)}` : null
            }))
        });
    } catch (error) {
        log.error('Feedback analytics error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/reconciliation/discrepancies
 * View discrepancies
 */
exports.getDiscrepancies = async (req, res) => {
    try {
        // Find potential discrepancies
        const tenMinutesAgo = new Date();
        tenMinutesAgo.setMinutes(tenMinutesAgo.getMinutes() - 10);

        // Stale pending
        const stalePending = await Transaction.find({
            status: 'PENDING',
            createdAt: { $lt: tenMinutesAgo }
        });

        // Successful without cycle
        const noCycleStarted = await Transaction.find({
            status: 'SUCCESSFUL',
            cycleStatus: 'NOT_STARTED'
        });

        const discrepancies = [
            ...stalePending.map(t => ({
                type: 'stale_pending',
                transaction: t,
                description: 'Transaction pending for more than 10 minutes'
            })),
            ...noCycleStarted.map(t => ({
                type: 'no_cycle_started',
                transaction: t,
                description: 'Payment successful but cycle never started'
            }))
        ];

        res.json({
            discrepancies,
            count: discrepancies.length,
            lastChecked: new Date()
        });
    } catch (error) {
        log.error('Get discrepancies error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/feedback/debug
 * Debug endpoint to check feedback system status
 */
exports.debugFeedbackStatus = async (req, res) => {
    try {
        const feedbackService = require('../services/feedbackService');
        const stats = await feedbackService.debugFeedbackStatus();
        res.json(stats);
    } catch (error) {
        log.error('Debug feedback status error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

// ==================== QR CODES ====================

/**
 * GET /api/admin/machines/:machineId/qrcode-url
 * Returns just the WhatsApp URL for frontend QR code generation
 * Lightweight alternative - frontend generates QR code using JS library
 */
exports.getMachineQRCodeUrl = async (req, res) => {
    try {
        const { machineId } = req.params;

        // Validate machine exists
        const allMachines = config.MACHINES.AVAILABLE_MACHINES;
        if (!allMachines.includes(machineId)) {
            return res.status(404).json({ error: 'Machine not found', machineId });
        }

        // Build WhatsApp deep link
        const phoneNumber = config.WHATSAPP_BUSINESS_PHONE;
        if (!phoneNumber) {
            return res.status(500).json({ error: 'WhatsApp phone number not configured' });
        }

        const message = encodeURIComponent(`START ${machineId}`);
        const whatsappUrl = `https://wa.me/${phoneNumber}?text=${message}`;

        res.json({
            machineId,
            machineName: formatMachineName(machineId),
            whatsappUrl,
            phoneNumber
        });
    } catch (error) {
        log.error('QR URL generation error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};

/**
 * GET /api/admin/machines/qrcode-urls
 * Returns all WhatsApp URLs for frontend QR code generation
 * Lightweight alternative - no QR image generation on server
 */
exports.getAllMachineQRCodeUrls = async (req, res) => {
    try {
        const allMachines = config.MACHINES.AVAILABLE_MACHINES;
        const phoneNumber = config.WHATSAPP_BUSINESS_PHONE;

        if (!phoneNumber) {
            return res.status(500).json({ error: 'WhatsApp phone number not configured' });
        }

        const machines = allMachines.map((machineId) => {
            const message = encodeURIComponent(`START ${machineId}`);
            const whatsappUrl = `https://wa.me/${phoneNumber}?text=${message}`;

            return {
                machineId,
                machineName: formatMachineName(machineId),
                whatsappUrl
            };
        });

        res.json({
            phoneNumber,
            totalMachines: allMachines.length,
            machines
        });
    } catch (error) {
        log.error('Bulk QR URL generation error', { error: error.message });
        res.status(500).json({ error: error.message });
    }
};
