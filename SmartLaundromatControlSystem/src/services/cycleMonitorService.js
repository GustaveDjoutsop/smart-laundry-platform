/**
 * Cycle Monitor Service
 * Monitors wash cycles and sends notifications when they complete
 */

const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const whatsappService = require('./whatsappService');
const { t } = require('../utils/i18n');
const { getSession } = require('../utils/stateManager');

// Check interval in milliseconds (1 minute)
const CHECK_INTERVAL = 60 * 1000;

// Helper to check if MongoDB is connected
const isDbConnected = () => mongoose.connection.readyState === 1;

// Helper function to format machine name
const formatMachineName = (machineId) => {
    return machineId.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
};

// Helper to get user's language preference
const getUserLanguage = async (phoneNumber) => {
    const session = await getSession(phoneNumber);
    return session.lang || 'en';
};

// Helper to format time for display (Cameroon timezone: Africa/Douala, UTC+1)
const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Africa/Douala'
    });
};

/**
 * Check for completed cycles and send notifications
 */
const checkCompletedCycles = async () => {
    if (!isDbConnected()) {
        return;
    }

    try {
        // Find all transactions where:
        // - Status is SUCCESSFUL
        // - Cycle status is IN_PROGRESS
        // - Cycle end time has passed
        // - Notification hasn't been sent yet (cycleCompletedNotified is not true)
        const completedCycles = await Transaction.find({
            status: 'SUCCESSFUL',
            cycleStatus: 'IN_PROGRESS',
            cycleEndsAt: { $lte: new Date() },
            cycleCompletedNotified: { $ne: true }
        });

        for (const transaction of completedCycles) {
            try {
                // Update cycle status to COMPLETED
                transaction.cycleStatus = 'COMPLETED';
                transaction.cycleCompletedNotified = true;
                await transaction.save();

                // Send WhatsApp notification
                const lang = await getUserLanguage(transaction.phoneNumber);
                const machineName = formatMachineName(transaction.machineId);
                const message = t('cycle_completed', lang, {
                    machine: machineName,
                    endTime: formatTime(transaction.cycleEndsAt)
                });

                await whatsappService.sendMessage(transaction.phoneNumber, message);
                console.log(`📱 Cycle completion notification sent to ${transaction.phoneNumber} for ${transaction.machineId}`);

            } catch (error) {
                console.error(`❌ Failed to process completed cycle for ${transaction.externalReference}:`, error.message);
                // Mark as notified anyway to prevent repeated failures
                transaction.cycleCompletedNotified = true;
                await transaction.save();
            }
        }

        if (completedCycles.length > 0) {
            console.log(`✅ Processed ${completedCycles.length} completed cycle(s)`);
        }

    } catch (error) {
        console.error('❌ Error checking completed cycles:', error.message);
    }
};

let monitorInterval = null;

/**
 * Start the cycle monitor
 */
const startMonitor = () => {
    // Only skip during Jest unit tests (JEST_WORKER_ID is set by Jest)
    // The deployed TEST environment should still run monitors
    if (process.env.JEST_WORKER_ID) {
        console.log('⏭️  Skipping cycle monitor during unit tests');
        return;
    }

    if (monitorInterval) {
        console.log('⚠️  Cycle monitor already running');
        return;
    }

    console.log(`🔄 Starting cycle monitor (checking every ${CHECK_INTERVAL / 1000}s)`);

    // Run immediately on start
    checkCompletedCycles();

    // Then run at regular intervals
    monitorInterval = setInterval(checkCompletedCycles, CHECK_INTERVAL);
};

/**
 * Stop the cycle monitor
 */
const stopMonitor = () => {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
        console.log('🛑 Cycle monitor stopped');
    }
};

module.exports = {
    startMonitor,
    stopMonitor,
    checkCompletedCycles
};
