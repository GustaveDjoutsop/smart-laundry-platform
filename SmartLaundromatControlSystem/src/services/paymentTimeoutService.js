/**
 * Payment Timeout Service
 * Monitors pending payments and marks them as TIMEOUT after 5 minutes
 * Notifies users when their payment has expired
 */

const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const whatsappService = require('./whatsappService');
const { t } = require('../utils/i18n');
const { getSession } = require('../utils/stateManager');
const { log } = require('../utils/logger');

// Check interval in milliseconds (1 minute)
const CHECK_INTERVAL = 60 * 1000;

// Timeout for pending payments (5 minutes)
const PENDING_PAYMENT_TIMEOUT_MINUTES = 5;

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

/**
 * Check for pending payments that have timed out
 * Marks them as TIMEOUT and notifies the user
 */
const checkPaymentTimeouts = async () => {
    if (!isDbConnected()) {
        return;
    }

    try {
        // Calculate the timeout threshold (5 minutes ago)
        const timeoutThreshold = new Date();
        timeoutThreshold.setMinutes(timeoutThreshold.getMinutes() - PENDING_PAYMENT_TIMEOUT_MINUTES);

        // Find all PENDING transactions older than 5 minutes
        const timedOutPayments = await Transaction.find({
            status: 'PENDING',
            createdAt: { $lte: timeoutThreshold }
        });

        for (const transaction of timedOutPayments) {
            try {
                // Mark as TIMEOUT
                transaction.status = 'TIMEOUT';
                transaction.timeoutAt = new Date();
                await transaction.save();

                // Get user language and send notification
                const lang = await getUserLanguage(transaction.phoneNumber);
                const machineName = formatMachineName(transaction.machineId);

                // Send timeout notification with retry buttons
                await whatsappService.sendButtons(
                    transaction.phoneNumber,
                    t('payment_timeout_expired', lang, { machine: machineName }),
                    [
                        { id: 'action_wash', title: t('btn_try_again', lang) },
                        { id: 'action_cancel', title: t('btn_main_menu', lang) }
                    ]
                );

                log.info('Payment timeout notification sent', {
                    phoneNumber: transaction.phoneNumber,
                    machineId: transaction.machineId,
                    externalReference: transaction.externalReference
                });

            } catch (error) {
                log.error('Failed to process timed out payment', {
                    externalReference: transaction.externalReference,
                    error: error.message
                });
                // Mark as TIMEOUT anyway to prevent repeated processing
                transaction.status = 'TIMEOUT';
                await transaction.save();
            }
        }

        if (timedOutPayments.length > 0) {
            log.info('Payment timeouts processed', { count: timedOutPayments.length });
        }

    } catch (error) {
        log.error('Error checking payment timeouts', { error: error.message });
    }
};

let timeoutInterval = null;

/**
 * Start the payment timeout monitor
 */
const startPaymentTimeoutMonitor = () => {
    // Skip during Jest unit tests
    if (process.env.JEST_WORKER_ID) {
        log.info('Skipping payment timeout monitor during unit tests');
        return;
    }

    if (timeoutInterval) {
        log.warn('Payment timeout monitor already running');
        return;
    }

    log.info('Starting payment timeout monitor', {
        checkInterval: CHECK_INTERVAL / 1000,
        timeoutMinutes: PENDING_PAYMENT_TIMEOUT_MINUTES
    });

    // Run immediately on start
    checkPaymentTimeouts();

    // Then run at regular intervals
    timeoutInterval = setInterval(checkPaymentTimeouts, CHECK_INTERVAL);
};

/**
 * Stop the payment timeout monitor
 */
const stopPaymentTimeoutMonitor = () => {
    if (timeoutInterval) {
        clearInterval(timeoutInterval);
        timeoutInterval = null;
        log.info('Payment timeout monitor stopped');
    }
};

module.exports = {
    startPaymentTimeoutMonitor,
    stopPaymentTimeoutMonitor,
    checkPaymentTimeouts,
    PENDING_PAYMENT_TIMEOUT_MINUTES
};
