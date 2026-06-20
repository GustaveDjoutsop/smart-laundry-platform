/**
 * Feedback Service
 * Sends feedback requests 35 minutes after cycle completion
 * and handles staff alerts for low ratings
 */

const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const whatsappService = require('./whatsappService');
const { t } = require('../utils/i18n');
const { getSession, setSession } = require('../utils/stateManager');
const config = require('../config/env');
const { log } = require('../utils/logger');

// Check interval in milliseconds (1 minute)
const CHECK_INTERVAL = 60 * 1000;

// Delay before sending feedback request (35 minutes after cycle completion)
const FEEDBACK_DELAY_MINUTES = 35;

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
 * Check for cycles ready for feedback request
 * Sends request 30 minutes after cycle completion
 */
const checkFeedbackRequests = async () => {
    if (!isDbConnected()) {
        return;
    }

    try {
        // Calculate the time threshold (30 minutes ago)
        const feedbackThreshold = new Date();
        feedbackThreshold.setMinutes(feedbackThreshold.getMinutes() - FEEDBACK_DELAY_MINUTES);

        // Find all transactions where:
        // - Cycle is COMPLETED
        // - Cycle ended more than 30 minutes ago
        // - Feedback request hasn't been sent yet
        // - No feedback has been submitted yet
        const readyForFeedback = await Transaction.find({
            status: 'SUCCESSFUL',
            cycleStatus: 'COMPLETED',
            cycleEndsAt: { $lte: feedbackThreshold },
            feedbackRequestSent: { $ne: true },
            'feedback.rating': { $exists: false }
        });

        for (const transaction of readyForFeedback) {
            try {
                // Mark feedback request as sent
                transaction.feedbackRequestSent = true;
                transaction.feedbackRequestedAt = new Date();
                await transaction.save();

                // Get user language and send feedback request
                const lang = await getUserLanguage(transaction.phoneNumber);
                const machineName = formatMachineName(transaction.machineId);

                // Update user session to track feedback state
                const session = await getSession(transaction.phoneNumber) || {};
                await setSession(transaction.phoneNumber, {
                    ...session,
                    step: 'AWAITING_FEEDBACK',
                    feedbackTransactionId: transaction._id.toString()
                });

                // Send feedback request with 3 rating buttons (5, 3, 1 stars)
                const message = t('feedback_request', lang, { machine: machineName });

                await whatsappService.sendButtons(transaction.phoneNumber, message, [
                    { id: 'feedback_5', title: '⭐⭐⭐⭐⭐' },
                    { id: 'feedback_3', title: '⭐⭐⭐' },
                    { id: 'feedback_1', title: '⭐' }
                ]);

                log.info('Feedback request sent', {
                    phoneNumber: transaction.phoneNumber,
                    machineId: transaction.machineId
                });

            } catch (error) {
                log.error('Failed to send feedback request', {
                    externalReference: transaction.externalReference,
                    error: error.message
                });
                // Mark as sent anyway to prevent repeated failures
                transaction.feedbackRequestSent = true;
                await transaction.save();
            }
        }

        if (readyForFeedback.length > 0) {
            log.info('Feedback requests sent', { count: readyForFeedback.length });
        }

    } catch (error) {
        log.error('Error checking feedback requests', { error: error.message });
    }
};

/**
 * Debug function to check feedback monitor status
 * Call this to see why feedback requests might not be sending
 */
const debugFeedbackStatus = async () => {
    if (!isDbConnected()) {
        log.error('Debug: Database not connected');
        return { error: 'Database not connected' };
    }

    try {
        const now = new Date();
        const feedbackThreshold = new Date();
        feedbackThreshold.setMinutes(feedbackThreshold.getMinutes() - FEEDBACK_DELAY_MINUTES);

        // Count transactions in different states
        const stats = {
            totalSuccessful: await Transaction.countDocuments({ status: 'SUCCESSFUL' }),
            inProgress: await Transaction.countDocuments({ status: 'SUCCESSFUL', cycleStatus: 'IN_PROGRESS' }),
            completed: await Transaction.countDocuments({ status: 'SUCCESSFUL', cycleStatus: 'COMPLETED' }),
            completedNoFeedbackSent: await Transaction.countDocuments({
                status: 'SUCCESSFUL',
                cycleStatus: 'COMPLETED',
                feedbackRequestSent: { $ne: true }
            }),
            readyForFeedback: await Transaction.countDocuments({
                status: 'SUCCESSFUL',
                cycleStatus: 'COMPLETED',
                cycleEndsAt: { $lte: feedbackThreshold },
                feedbackRequestSent: { $ne: true },
                'feedback.rating': { $exists: false }
            }),
            currentTime: now.toISOString(),
            feedbackThreshold: feedbackThreshold.toISOString()
        };

        log.info('Feedback debug stats', stats);
        return stats;
    } catch (error) {
        log.error('Debug error', { error: error.message });
        return { error: error.message };
    }
};

/**
 * Send staff alert for low ratings (1-2 stars)
 */
const sendStaffAlert = async (transaction, comment = '') => {
    const staffPhone = config.STAFF_ALERT_PHONE;

    if (!staffPhone) {
        log.warn('No STAFF_ALERT_PHONE configured - skipping staff alert');
        return;
    }

    try {
        const machineName = formatMachineName(transaction.machineId);
        const message = t('staff_alert_low_rating', 'en', {
            machine: machineName,
            phone: transaction.phoneNumber,
            rating: transaction.feedback.rating,
            comment: comment || 'No comment provided',
            time: formatTime(new Date())
        });

        await whatsappService.sendMessage(staffPhone, message);

        // Mark alert as sent
        transaction.feedback.staffAlertSent = true;
        await transaction.save();

        log.warn('Staff alert sent for low rating', { phoneNumber: transaction.phoneNumber });
    } catch (error) {
        log.error('Failed to send staff alert', { error: error.message });
    }
};

/**
 * Process a feedback rating submission
 */
const processFeedbackRating = async (phoneNumber, rating) => {
    const session = await getSession(phoneNumber);
    const transactionId = session.feedbackTransactionId;

    log.info('Processing feedback rating', {
        rating,
        phoneNumber,
        transactionId
    });

    if (!transactionId) {
        log.warn('No pending feedback', { phoneNumber });
        return { success: false, error: 'No pending feedback' };
    }

    try {
        const transaction = await Transaction.findById(transactionId);

        if (!transaction) {
            log.warn('Transaction not found for feedback', { transactionId });
            return { success: false, error: 'Transaction not found' };
        }

        // Save the rating
        transaction.feedback = {
            rating,
            submittedAt: new Date(),
            staffAlertSent: false
        };
        await transaction.save();
        log.info('Feedback rating saved', { rating, transactionId });

        const lang = await getUserLanguage(phoneNumber);

        // For non-5 star ratings, ask for comment
        if (rating < 5) {
            log.info('Rating < 5 stars - asking for comment', { phoneNumber, rating });
            await setSession(phoneNumber, {
                ...session,
                step: 'AWAITING_FEEDBACK_COMMENT',
                feedbackTransactionId: transactionId
            });

            return {
                success: true,
                needsComment: true,
                message: t('feedback_thanks_low', lang)
            };
        }

        // For 5 stars, just thank them
        log.info('5 stars received - no comment needed', { phoneNumber });
        await setSession(phoneNumber, { step: 'MAIN_MENU', lang: session.lang });

        return {
            success: true,
            needsComment: false,
            message: t('feedback_thanks_high', lang)
        };

    } catch (error) {
        log.error('Error processing feedback rating', { error: error.message });
        return { success: false, error: error.message };
    }
};

// Maximum words allowed for feedback comments
const MAX_COMMENT_WORDS = 100;

/**
 * Count words in a string
 */
const countWords = (text) => {
    return text.trim().split(/\s+/).filter(word => word.length > 0).length;
};

/**
 * Process a feedback comment (for non-5 star ratings)
 */
const processFeedbackComment = async (phoneNumber, comment) => {
    const session = await getSession(phoneNumber);
    const transactionId = session.feedbackTransactionId;
    const lang = await getUserLanguage(phoneNumber);

    log.info('Processing feedback comment', { phoneNumber, transactionId });

    if (!transactionId) {
        log.warn('No transactionId found for comment', { phoneNumber });
        return { success: false, message: t('session_error', lang) };
    }

    // Validate word count
    const wordCount = countWords(comment);
    if (wordCount > MAX_COMMENT_WORDS) {
        log.warn('Comment too long', { phoneNumber, wordCount });
        return {
            success: false,
            tooLong: true,
            message: t('feedback_comment_too_long', lang, { words: wordCount })
        };
    }

    try {
        const transaction = await Transaction.findById(transactionId);

        if (!transaction) {
            log.warn('Transaction not found for comment', { transactionId });
            return { success: false, message: t('session_error', lang) };
        }

        // Save the comment
        transaction.feedback.comment = comment.trim();
        await transaction.save();
        log.info('Comment saved', {
            transactionId,
            commentPreview: comment.substring(0, 50)
        });

        // Send staff alert for all non-5 star ratings
        log.info('Sending staff alert for rating', { rating: transaction.feedback.rating });
        await sendStaffAlert(transaction, comment);

        // Clear feedback state
        await setSession(phoneNumber, { step: 'MAIN_MENU', lang: session.lang });

        return {
            success: true,
            message: t('feedback_comment_received', lang)
        };

    } catch (error) {
        log.error('Error processing feedback comment', { error: error.message });
        return { success: false, message: t('session_error', lang) };
    }
};

/**
 * Skip feedback comment
 */
const skipFeedbackComment = async (phoneNumber) => {
    const session = await getSession(phoneNumber);
    const transactionId = session.feedbackTransactionId;
    const lang = getUserLanguage(phoneNumber);

    if (transactionId) {
        try {
            const transaction = await Transaction.findById(transactionId);
            if (transaction && transaction.feedback?.rating <= 2) {
                // Still send staff alert even without comment
                await sendStaffAlert(transaction);
            }
        } catch (error) {
            log.error('Error in skipFeedbackComment', { error: error.message });
        }
    }

    // Clear feedback state
    setSession(phoneNumber, { step: 'MAIN_MENU', lang: session.lang });

    return {
        success: true,
        message: t('feedback_skipped', lang)
    };
};

let feedbackInterval = null;

/**
 * Start the feedback monitor
 */
const startFeedbackMonitor = () => {
    // Only skip during Jest unit tests (JEST_WORKER_ID is set by Jest)
    // The deployed TEST environment should still run monitors
    if (process.env.JEST_WORKER_ID) {
        log.info('Skipping feedback monitor during unit tests');
        return;
    }

    if (feedbackInterval) {
        log.warn('Feedback monitor already running');
        return;
    }

    log.info('Starting feedback monitor', {
        checkInterval: CHECK_INTERVAL / 1000,
        delayMinutes: FEEDBACK_DELAY_MINUTES
    });

    // Run immediately on start
    checkFeedbackRequests();

    // Then run at regular intervals
    feedbackInterval = setInterval(checkFeedbackRequests, CHECK_INTERVAL);
};

/**
 * Stop the feedback monitor
 */
const stopFeedbackMonitor = () => {
    if (feedbackInterval) {
        clearInterval(feedbackInterval);
        feedbackInterval = null;
        log.info('Feedback monitor stopped');
    }
};

module.exports = {
    startFeedbackMonitor,
    stopFeedbackMonitor,
    checkFeedbackRequests,
    processFeedbackRating,
    processFeedbackComment,
    skipFeedbackComment,
    sendStaffAlert,
    debugFeedbackStatus,
    FEEDBACK_DELAY_MINUTES
};
