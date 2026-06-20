const crypto = require('crypto');
const { triggerMachine } = require('../handlers/mqttHandler');
const config = require('../config/env');
const { handleIncomingMessage } = require('../handlers/whatsappHandler');
const Transaction = require('../models/Transaction');
const { getPaymentStatus } = require('../services/mtnService');
const whatsappService = require('../services/whatsappService');
const { t } = require('../utils/i18n');
const { getSession } = require('../utils/stateManager');
const { log } = require('../utils/logger');

// ============================================
// Webhook Signature Validation Functions
// ============================================

/**
 * Validate Campay webhook signature using HMAC-SHA256
 * @param {Object} body - Request body
 * @param {string} signature - Signature from request header
 * @returns {boolean} True if signature is valid
 */
function validateCampaySignature(body, signature) {
    if (!config.CAMPAY_WEBHOOK_SECRET) {
        log.warn('CAMPAY_WEBHOOK_SECRET not configured - skipping signature validation (INSECURE!)');
        return true; // Allow in development, but log warning
    }

    if (!signature) {
        log.error('No signature provided in Campay webhook');
        return false;
    }

    try {
        // Campay typically sends signature as HMAC-SHA256 hex digest.
        // Prefer validating against the raw request body bytes if available.
        const payload = typeof body === 'string'
            ? body
            : Buffer.isBuffer(body)
                ? body.toString('utf8')
                : JSON.stringify(body);

        const expectedSignatureHex = crypto
            .createHmac('sha256', config.CAMPAY_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');

        const providedHex = String(signature).trim();
        const expectedBuf = Buffer.from(expectedSignatureHex, 'hex');
        const providedBuf = Buffer.from(providedHex, 'hex');

        // timingSafeEqual requires same length buffers
        if (providedBuf.length !== expectedBuf.length) {
            return false;
        }

        // Constant-time comparison to prevent timing attacks
        return crypto.timingSafeEqual(providedBuf, expectedBuf);
    } catch (error) {
        log.error('Campay signature validation error', { error: error.message });
        return false;
    }
}

/**
 * Validate WhatsApp (Meta) webhook signature using SHA256
 * Meta sends signature in X-Hub-Signature-256 header as "sha256=<signature>"
 * @param {Object} body - Request body
 * @param {string} signature - Signature from X-Hub-Signature-256 header
 * @returns {boolean} True if signature is valid
 */
function validateWhatsAppSignature(body, signature) {
    // Use app secret for signature validation, not the access token
    if (!config.META_APP_SECRET) {
        log.warn('META_APP_SECRET not configured - skipping WhatsApp signature validation (INSECURE!)');
        return true; // Allow in test/dev environments when secret not configured
    }

    if (!signature) {
        log.error('No X-Hub-Signature-256 header in WhatsApp webhook');
        return false;
    }

    try {
        // Remove 'sha256=' prefix if present
        const signatureHash = String(signature).startsWith('sha256=')
            ? String(signature).substring(7)
            : String(signature);

        // Meta uses the APP SECRET to sign the *raw request body bytes*.
        // If we re-serialize JSON (JSON.stringify(req.body)), the signature usually won't match.
        const payload = typeof body === 'string'
            ? body
            : Buffer.isBuffer(body)
                ? body.toString('utf8')
                : JSON.stringify(body);

        const expectedSignatureHex = crypto
            .createHmac('sha256', config.META_APP_SECRET)
            .update(payload)
            .digest('hex');

        const expectedBuf = Buffer.from(expectedSignatureHex, 'hex');
        const providedBuf = Buffer.from(signatureHash, 'hex');

        // Constant-time comparison requires same length
        if (providedBuf.length !== expectedBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(providedBuf, expectedBuf);
    } catch (error) {
        log.error('WhatsApp signature validation error', { error: error.message });
        return false;
    }
}

/**
 * Validate MTN webhook signature
 * MTN may use different signature mechanisms depending on configuration
 * This is a placeholder - adjust based on MTN's actual webhook security
 * @param {Object} body - Request body
 * @param {string} signature - Signature from request header
 * @returns {boolean} True if signature is valid
 */
function validateMtnSignature(body, signature) {
    // MTN webhook security varies by region/configuration
    // In sandbox mode, signatures may not be enforced
    if (config.MTN_ENV === 'sandbox') {
        log.info('MTN sandbox mode - skipping signature validation', { environment: 'sandbox' });
        return true;
    }

    // TODO: Implement MTN production signature validation when specifications are available
    // For now, log warning in production
    if (config.IS_PRODUCTION) {
        log.warn('MTN webhook signature validation not implemented - review MTN API docs');
    }

    return true; // Allow for now, but should be implemented for production
}

// Helper function to format machine name
const formatMachineName = (machineId) => {
    return machineId.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
};

// Helper to get user's language preference
const getUserLanguage = async (phoneNumber) => {
    const session = await getSession(phoneNumber);
    return session.lang || 'en';
};

// Helper to extract and translate failure reason from payment provider
const getFailureReason = (payload, lang = 'en') => {
    // Try to extract reason from various possible fields
    const rawReason = payload.reason ||
                      payload.failure_reason ||
                      payload.failureReason ||
                      payload.message ||
                      payload.error ||
                      payload.status_reason ||
                      '';

    const reasonLower = rawReason.toLowerCase();

    // Map common failure reasons to translation keys
    if (reasonLower.includes('cancel') || reasonLower.includes('user') || reasonLower.includes('rejected by payer')) {
        return t('failure_reason_cancelled', lang);
    }
    if (reasonLower.includes('timeout') || reasonLower.includes('expired') || reasonLower.includes('timed out')) {
        return t('failure_reason_timeout', lang);
    }
    if (reasonLower.includes('insufficient') || reasonLower.includes('balance') || reasonLower.includes('not enough')) {
        return t('failure_reason_insufficient_funds', lang);
    }
    if (reasonLower.includes('declined') || reasonLower.includes('refused') || reasonLower.includes('denied')) {
        return t('failure_reason_declined', lang);
    }

    // If we have a raw reason but couldn't categorize it, return it directly
    if (rawReason && rawReason.length > 0) {
        return rawReason;
    }

    // Default to unknown
    return t('failure_reason_unknown', lang);
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

// Campay Webhook
exports.handleCampay = async (req, res) => {
    // Validate webhook signature first (CRITICAL SECURITY CHECK)
    const signature = req.headers['x-campay-signature'] || req.headers['x-signature'];
    if (!validateCampaySignature(req.body, signature)) {
        log.error('SECURITY: Invalid Campay webhook signature - potential fraud attempt');
        return res.status(401).json({ error: 'Invalid signature' });
    }

    // Campay sends: reference (their ID), external_reference (our UUID), status, amount, etc.
    const { reference, external_reference, status } = req.body;
    log.payment('Campay webhook received', { reference, externalReference: external_reference, status });
    log.info('Full webhook payload', { payload: req.body });

    if (!config.MONGO_URI) {
        log.warn('Running without DB - Cannot process webhook', { externalReference: external_reference });
        return res.status(200).send('OK. Running without database.');
    }

    // Find the transaction in our database using our external_reference (the UUID we sent to Campay)
    const transaction = await Transaction.findOne({ externalReference: external_reference });

    if (!transaction) {
        log.warn('Webhook for unknown transaction', { campayRef: reference, externalRef: external_reference });
        return res.status(200).send('OK. Transaction not found.');
    }

    // Idempotency Check: If we have already processed this payment, don't do it again.
    if (transaction.status === 'SUCCESSFUL') {
        log.info('Webhook for already successful transaction - ignoring', { reference });
        return res.status(200).send('OK. Already processed.');
    }

    if (status === 'SUCCESSFUL' && transaction.status !== 'SUCCESSFUL') {
        // RACE CONDITION PROTECTION: Check if another transaction already claimed this machine
        // Use atomic findOneAndUpdate to prevent two webhooks from both succeeding
        const existingActiveCycle = await Transaction.findOne({
            machineId: transaction.machineId,
            status: 'SUCCESSFUL',
            cycleStatus: 'IN_PROGRESS',
            cycleEndsAt: { $gt: new Date() },
            _id: { $ne: transaction._id } // Exclude current transaction
        });

        if (existingActiveCycle) {
            // Another payment already claimed this machine - reject this one
            log.warn('RACE CONDITION DETECTED - Machine already has active cycle', {
                machineId: transaction.machineId,
                existingTransaction: existingActiveCycle.externalReference
            });
            transaction.status = 'FAILED';
            transaction.failureReason = 'Machine was claimed by another payment';
            await transaction.save();

            // Notify user their payment failed due to race condition
            try {
                const lang = await getUserLanguage(transaction.phoneNumber);
                const machineName = formatMachineName(transaction.machineId);
                const message = t('machine_already_taken_refund', lang, { machine: machineName });
                await whatsappService.sendMessage(transaction.phoneNumber, message);
                log.info('Race condition notification sent', { phoneNumber: transaction.phoneNumber });
            } catch (waError) {
                log.error('Failed to send race condition notification', { error: waError.message });
            }

            return res.status(200).send('OK. Machine already claimed.');
        }

        // Use atomic update to claim the machine - only succeeds if status is still PENDING
        const cycleEndTime = new Date();
        cycleEndTime.setMinutes(cycleEndTime.getMinutes() + (transaction.cycleDuration || 30));

        const updatedTransaction = await Transaction.findOneAndUpdate(
            {
                _id: transaction._id,
                status: 'PENDING' // Only update if still PENDING (atomic check)
            },
            {
                $set: {
                    status: 'SUCCESSFUL',
                    cycleStatus: 'IN_PROGRESS',
                    cycleStartedAt: new Date(),
                    cycleEndsAt: cycleEndTime
                }
            },
            { new: true }
        );

        if (!updatedTransaction) {
            // Another process already updated this transaction
            log.info('Transaction already processed by another request', { externalReference: external_reference });
            return res.status(200).send('OK. Already processed by another request.');
        }

        log.payment('Payment SUCCESSFUL - Cycle started', {
            machineId: transaction.machineId,
            cycleEndsAt: cycleEndTime.toISOString()
        });
        triggerMachine(transaction.machineId, transaction.pulseCount);

        // Send WhatsApp confirmation to user
        try {
            const lang = await getUserLanguage(transaction.phoneNumber);
            const machineName = formatMachineName(transaction.machineId);
            const message = t('payment_confirmed', lang, {
                amount: transaction.amount,
                machine: machineName,
                duration: transaction.cycleDuration,
                endTime: formatTime(cycleEndTime)
            });
            await whatsappService.sendMessage(transaction.phoneNumber, message);
            log.info('Payment confirmation sent', { phoneNumber: transaction.phoneNumber });
        } catch (waError) {
            log.error('Failed to send WhatsApp confirmation', { error: waError.message });
        }
    } else if (status === 'FAILED' && transaction.status !== 'FAILED') {
        // Get user language first for translation
        const lang = await getUserLanguage(transaction.phoneNumber);

        // Extract and translate failure reason
        const failureReason = getFailureReason(req.body, lang);

        transaction.status = 'FAILED';
        transaction.failureReason = failureReason;
        await transaction.save();
        log.payment('Payment FAILED', { machineId: transaction.machineId, reason: failureReason });

        // Send WhatsApp failure notification to user with reason
        try {
            const machineName = formatMachineName(transaction.machineId);
            const message = t('payment_failed_notification', lang, {
                machine: machineName,
                reason: failureReason
            });
            await whatsappService.sendMessage(transaction.phoneNumber, message);
            log.info('Payment failure notification sent', { phoneNumber: transaction.phoneNumber });
        } catch (waError) {
            log.error('Failed to send WhatsApp failure notification', { error: waError.message });
        }
    }
    res.status(200).send('OK');
};

// MTN MoMo Webhook (Callback URL)
exports.handleMtn = async (req, res) => {
    // Validate webhook signature (CRITICAL SECURITY CHECK)
    const signature = req.headers['x-mtn-signature'] || req.headers['authorization'];
    if (!validateMtnSignature(req.body, signature)) {
        log.error('SECURITY: Invalid MTN webhook signature - potential fraud attempt');
        return res.status(401).json({ error: 'Invalid signature' });
    }

    const { externalId, status, financialTransactionId } = req.body;
    log.payment('MTN MoMo webhook received', { externalId, status, financialTransactionId });

    if (!config.MONGO_URI) {
        log.warn('Running without DB - Cannot process MTN webhook', { externalId });
        return res.status(200).send('OK. Running without database.');
    }

    // Find the transaction in our database using the externalId (our externalReference)
    const transaction = await Transaction.findOne({ externalReference: externalId });

    if (!transaction) {
        log.warn('MTN webhook for unknown transaction', { externalId });
        return res.status(200).send('OK. Transaction not found.');
    }

    // Idempotency Check: If we have already processed this payment, don't do it again.
    if (transaction.status === 'SUCCESSFUL') {
        log.info('MTN webhook for already successful transaction - ignoring', { externalId });
        return res.status(200).send('OK. Already processed.');
    }

    if (status === 'SUCCESSFUL' && transaction.status !== 'SUCCESSFUL') {
        transaction.status = 'SUCCESSFUL';
        transaction.cycleStatus = 'IN_PROGRESS';
        transaction.cycleStartedAt = new Date();
        transaction.mtnTransactionId = financialTransactionId;

        // Calculate cycle end time based on duration
        const cycleEndTime = new Date();
        cycleEndTime.setMinutes(cycleEndTime.getMinutes() + (transaction.cycleDuration || 30));
        transaction.cycleEndsAt = cycleEndTime;
        await transaction.save();

        log.payment('MTN Payment SUCCESSFUL - Cycle started', {
            machineId: transaction.machineId,
            cycleEndsAt: cycleEndTime.toISOString()
        });
        triggerMachine(transaction.machineId, transaction.pulseCount);

        // Send WhatsApp confirmation to user
        try {
            const lang = await getUserLanguage(transaction.phoneNumber);
            const machineName = formatMachineName(transaction.machineId);
            const message = t('payment_confirmed', lang, {
                amount: transaction.amount,
                machine: machineName,
                duration: transaction.cycleDuration,
                endTime: formatTime(cycleEndTime)
            });
            await whatsappService.sendMessage(transaction.phoneNumber, message);
            log.info('MTN payment confirmation sent', { phoneNumber: transaction.phoneNumber });
        } catch (waError) {
            log.error('Failed to send WhatsApp confirmation', { error: waError.message });
        }
    } else if (status === 'FAILED' && transaction.status !== 'FAILED') {
        // Get user language first for translation
        const lang = await getUserLanguage(transaction.phoneNumber);

        // Extract and translate failure reason
        const failureReason = getFailureReason(req.body, lang);

        transaction.status = 'FAILED';
        transaction.failureReason = failureReason;
        await transaction.save();
        log.payment('MTN Payment FAILED', { machineId: transaction.machineId, reason: failureReason });

        // Send WhatsApp failure notification to user with reason
        try {
            const machineName = formatMachineName(transaction.machineId);
            const message = t('payment_failed_notification', lang, {
                machine: machineName,
                reason: failureReason
            });
            await whatsappService.sendMessage(transaction.phoneNumber, message);
            log.info('MTN payment failure notification sent', { phoneNumber: transaction.phoneNumber });
        } catch (waError) {
            log.error('Failed to send WhatsApp failure notification', { error: waError.message });
        }
    }
    res.status(200).send('OK');
};

// MTN MoMo Status Check (polling fallback if webhooks don't work)
exports.checkMtnStatus = async (req, res) => {
    const { referenceId } = req.params;

    if (!referenceId) {
        return res.status(400).json({ error: 'Reference ID required' });
    }

    const result = await getPaymentStatus(referenceId);

    if (result.success) {
        // If status is SUCCESSFUL, update transaction
        if (result.status === 'SUCCESSFUL') {
            const transaction = await Transaction.findOne({ mtnReferenceId: referenceId });
            if (transaction && transaction.status !== 'SUCCESSFUL') {
                transaction.status = 'SUCCESSFUL';
                transaction.cycleStatus = 'IN_PROGRESS';
                transaction.cycleStartedAt = new Date();
                const cycleEndTime = new Date();
                cycleEndTime.setMinutes(cycleEndTime.getMinutes() + (transaction.cycleDuration || 30));
                transaction.cycleEndsAt = cycleEndTime;
                await transaction.save();

                log.payment('MTN Payment SUCCESSFUL via status check', { machineId: transaction.machineId });
                triggerMachine(transaction.machineId, transaction.pulseCount);
            }
        }
        return res.json(result);
    }

    res.status(500).json(result);
};

// WhatsApp Webhook (Verification)
exports.verifyWhatsApp = (req, res) => {
    if (req.query['hub.verify_token'] === config.META_VERIFY) {
        res.status(200).send(req.query['hub.challenge']);
    } else {
        res.sendStatus(403);
    }
};

// WhatsApp Incoming Message
exports.handleWhatsApp = async (req, res) => {
    // Validate webhook signature for message webhooks (CRITICAL SECURITY CHECK)
    // Note: Verification webhook (verifyWhatsApp) uses token verification, not signature
    const signature = req.headers['x-hub-signature-256'];
    const rawBody = req.rawBody || req.body;
    if (!validateWhatsAppSignature(rawBody, signature)) {
        log.error('SECURITY: Invalid WhatsApp webhook signature - potential fraud attempt');
        return res.status(401).json({ error: 'Invalid signature' });
    }

    log.info('WhatsApp webhook received', { payload: req.body });

    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];

    if (change && change.value?.messages?.[0]) {
        const message = change.value.messages[0];
        const from = message.from; // User's phone number

        let messageBody = null;
        let buttonId = null;

        if (message.type === 'text') {
            messageBody = message.text.body;
        } else if (message.type === 'interactive' && message.interactive?.type === 'button_reply') {
            buttonId = message.interactive.button_reply.id;
        }

        if (messageBody || buttonId) {
            log.info('WhatsApp message received', { from, text: messageBody, buttonId });
            await handleIncomingMessage(from, messageBody, buttonId);
        }
    }

    res.status(200).send('OK');
};