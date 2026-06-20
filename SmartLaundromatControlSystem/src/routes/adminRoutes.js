/**
 * Admin API Routes
 * All routes prefixed with /api/admin
 * Protected with authentication and permission-based authorization
 */

const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, hasPermission } = require('../middleware/authMiddleware');

// ============================================
// All admin routes require authentication
// ============================================
router.use(authenticate);

// ==================== DASHBOARD ====================
// Requires: finance:dashboard permission
router.get('/dashboard/summary',
    hasPermission('finance:dashboard'),
    adminController.getDashboardSummary
);
router.get('/dashboard/stats',
    hasPermission('finance:dashboard'),
    adminController.getDashboardStats
);

// ==================== MACHINES ====================
// Read: machines:read, Control: machines:control, Maintenance: machines:maintenance
router.get('/machines',
    hasPermission('machines:read'),
    adminController.getMachines
);

// GET /api/admin/machines/qrcode-urls - Get all WhatsApp URLs for frontend QR generation
router.get('/machines/qrcode-urls',
    hasPermission('machines:read'),
    adminController.getAllMachineQRCodeUrls
);

router.get('/machines/:id',
    hasPermission('machines:read'),
    adminController.getMachineById
);
router.get('/machines/:id/history',
    hasPermission('machines:read'),
    adminController.getMachineHistory
);

// GET /api/admin/machines/:machineId/qrcode-url - Get WhatsApp URL for frontend QR generation
router.get('/machines/:machineId/qrcode-url',
    hasPermission('machines:read'),
    adminController.getMachineQRCodeUrl
);

// ==================== TRANSACTIONS ====================
// Read: transactions:read, Export: transactions:export
router.get('/transactions',
    hasPermission('transactions:read'),
    adminController.getTransactions
);
router.get('/transactions/export',
    hasPermission('transactions:export'),
    adminController.exportTransactions
);
router.get('/transactions/:id',
    hasPermission('transactions:read'),
    adminController.getTransactionById
);

// ==================== REVENUE ====================
// Requires: finance:reports permission
router.get('/revenue/summary',
    hasPermission('finance:reports'),
    adminController.getRevenueSummary
);
router.get('/revenue/by-provider',
    hasPermission('finance:reports'),
    adminController.getRevenueByProvider
);
router.get('/revenue/by-program',
    hasPermission('finance:reports'),
    adminController.getRevenueByProgram
);
router.get('/revenue/by-machine',
    hasPermission('finance:reports'),
    adminController.getRevenueByMachine
);
router.get('/revenue/trends',
    hasPermission('finance:reports'),
    adminController.getRevenueTrends
);

// ==================== MAINTENANCE ====================
// Requires: machines:maintenance permission
router.get('/maintenance/alerts',
    hasPermission('machines:maintenance'),
    adminController.getMaintenanceAlerts
);
router.get('/maintenance/history',
    hasPermission('machines:maintenance'),
    adminController.getMaintenanceHistory
);
router.post('/maintenance/log',
    hasPermission('machines:maintenance'),
    adminController.createMaintenanceLog
);

// ==================== REPORTS ====================
// Read/View: finance:reports, Export: finance:export
router.get('/reports/daily/:date',
    hasPermission('finance:reports'),
    adminController.getDailyReport
);
router.get('/reports/monthly/:year/:month',
    hasPermission('finance:reports'),
    adminController.getMonthlyReport
);
router.post('/reports/export',
    hasPermission('finance:export'),
    adminController.exportReport
);

// ==================== EXPENSES ====================
// View: finance:reports, Create/Manage: finance:settings
router.get('/expenses',
    hasPermission('finance:reports'),
    adminController.getExpenses
);
router.post('/expenses',
    hasPermission('finance:settings'),
    adminController.createExpense
);

// ==================== RECONCILIATION ====================
// Requires: finance:settings permission
router.post('/reconciliation/run',
    hasPermission('finance:settings'),
    adminController.runReconciliation
);
router.get('/reconciliation/discrepancies',
    hasPermission('finance:reports'),
    adminController.getDiscrepancies
);

// ==================== FEEDBACK ====================
// Requires: transactions:read permission (viewing customer feedback)
router.get('/feedback',
    hasPermission('transactions:read'),
    adminController.getFeedback
);
router.get('/feedback/analytics',
    hasPermission('finance:reports'),
    adminController.getFeedbackAnalytics
);
router.get('/feedback/debug',
    hasPermission('system:logs'),
    adminController.debugFeedbackStatus
);

module.exports = router;
