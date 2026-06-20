const mongoose = require('mongoose');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/env');
const Transaction = require('../models/Transaction');

// Helper to check if MongoDB is actually connected
const isDbConnected = () => mongoose.connection.readyState === 1;

/**
 * Format phone number for Campay API
 * Campay expects format: 237xxxxxxxxx (12 digits total)
 * Cameroon mobile numbers start with 6 (e.g., 6xxxxxxxx)
 */
const formatPhoneNumber = (phone) => {
    // Remove any spaces, dashes, or plus signs
    let cleaned = phone.replace(/[\s\-\+]/g, '');

    // If starts with 237, check if it has the correct length
    if (cleaned.startsWith('237')) {
        // Correct format: 237 + 9 digits = 12 total
        // Sometimes the leading 6 is missing: 237 + 8 digits = 11 total
        if (cleaned.length === 11) {
            // Missing the leading 6 after 237, add it
            // e.g., 23752100754 -> 237652100754
            cleaned = '237' + '6' + cleaned.substring(3);
            console.log(`📱 Phone number corrected: added missing '6' -> ${cleaned}`);
        }
        return cleaned;
    }

    // If starts with 0, replace with 237
    if (cleaned.startsWith('0')) {
        return '237' + cleaned.substring(1);
    }

    // If it's 8 digits starting without 6, add 6 prefix
    if (cleaned.length === 8 && !cleaned.startsWith('6')) {
        cleaned = '6' + cleaned;
    }

    // If it's 9 digits (local format), add 237
    if (cleaned.length === 9) {
        return '237' + cleaned;
    }

    return cleaned;
};

const getToken = async () => {
    try {
        // Use environment-specific URL (sandbox for dev/test, production for stage/prod)
        const tokenUrl = `${config.CAMPAY_BASE_URL}/api/token/`;
        console.log(`🔐 Campay Auth [${config.NODE_ENV}]: ${tokenUrl}`);

        const response = await axios.post(tokenUrl, {
            username: config.CAMPAY_KEY,
            password: config.CAMPAY_SECRET
        });
        return response.data.token;
    } catch (error) {
        console.error('❌ Campay Token Error:', error.response?.data || error.message);
        return null;
    }
};

/**
 * Creates a transaction record and requests a payment from the Campay API.
 * @param {string} phone - The user's phone number in format 237xxxxxxxx.
 * @param {number} amount - The amount to charge.
 * @param {string} description - A description for the payment.
 * @param {string} machineId - The ID of the machine this payment is for.
 * @param {number} pulseCount - The number of pulses to trigger on success.
 * @param {number} cycleDuration - The duration of the wash cycle in minutes.
 * @returns {Promise<object>} - An object indicating success and reference IDs.
 */
// Timeout for pending payments (in minutes) - matches whatsappHandler.js
const PENDING_PAYMENT_TIMEOUT_MINUTES = 5;

const requestPayment = async (phone, amount, description, machineId, pulseCount, cycleDuration = 30) => {
    const token = await getToken();
    if (!token) {
        return { success: false, message: "Authentication with payment provider failed." };
    }

    const externalReference = uuidv4(); // Our unique ID for this transaction
    const formattedPhone = formatPhoneNumber(phone);

    try {
        // RACE CONDITION PROTECTION: Check if machine is already claimed before creating transaction
        if (isDbConnected()) {
            // Check for active cycle
            const existingActiveCycle = await Transaction.findOne({
                machineId,
                status: 'SUCCESSFUL',
                cycleStatus: 'IN_PROGRESS',
                cycleEndsAt: { $gt: new Date() }
            });

            if (existingActiveCycle) {
                console.log(`⚠️  Machine ${machineId} already has active cycle - blocking payment initiation`);
                return { success: false, message: "This machine is currently in use. Please select another machine." };
            }

            // Check for recent pending payments (within timeout window)
            const pendingTimeout = new Date();
            pendingTimeout.setMinutes(pendingTimeout.getMinutes() - PENDING_PAYMENT_TIMEOUT_MINUTES);

            const existingPending = await Transaction.findOne({
                machineId,
                status: 'PENDING',
                createdAt: { $gt: pendingTimeout }
            });

            if (existingPending) {
                console.log(`⚠️  Machine ${machineId} has pending payment from ${existingPending.phoneNumber} - blocking new payment`);
                return { success: false, message: "This machine has a pending payment. Please wait or select another machine." };
            }
        }

        // Create a pending transaction record in our database FIRST (if DB is connected).
        if (isDbConnected()) {
            await Transaction.create({
                externalReference,
                amount,
                phoneNumber: formattedPhone,
                machineId,
                pulseCount,
                cycleDuration,
                description,
                status: 'PENDING',
                cycleStatus: 'NOT_STARTED'
            });
        } else {
            console.log(`⚠️  Running without DB - Transaction ${externalReference} not persisted`);
        }

        // Now, request the payment from Campay (environment-specific URL)
        const collectUrl = `${config.CAMPAY_BASE_URL}/api/collect/`;
        console.log(`💳 Campay Collect [${config.NODE_ENV}]: ${collectUrl}`);

        const response = await axios.post(collectUrl, {
            amount: amount.toString(),
            currency: "XAF",
            from: formattedPhone,
            description: description,
            external_reference: externalReference
        }, { headers: { Authorization: `Token ${token}` }});

        return { success: true, reference: response.data.reference, internalRef: externalReference };
    } catch (error) {
        console.error('❌ Campay Collect Error:', error.response?.data || error.message);
        console.log('Debug - Full error data:', JSON.stringify(error.response?.data, null, 2));

        // Extract user-friendly error message
        let userMessage = "Failed to initiate payment.";
        if (error.response?.data) {
            const errorData = error.response.data;
            // Campay uses 'error_code' not 'code'
            const errorCode = errorData.error_code || errorData.code;
            console.log('Debug - Error code:', errorCode);
            console.log('Debug - Error message:', errorData.message);

            // Handle Campay error codes with clear, user-friendly messages
            switch (errorCode) {
                case 'ER102':
                    userMessage = "Sorry, we can only accept MTN Mobile Money or Orange Money. Your number appears to be from a different network.";
                    break;
                case 'ER101':
                    userMessage = "The phone number format is incorrect. Please make sure you entered the correct number.";
                    break;
                case 'ER103':
                    userMessage = "You don't have enough money in your mobile money account. Please add funds and try again.";
                    break;
                case 'ER104':
                    userMessage = "This amount exceeds your daily transaction limit. Please try a smaller amount or contact your network provider.";
                    break;
                case 'ER105':
                    userMessage = "Your mobile money account is not activated. Please activate it with your network provider first.";
                    break;
                case 'ER106':
                    userMessage = "The payment was declined. Please check with your network provider and try again.";
                    break;
                default:
                    // Fallback to error details or messages from API, but keep them simple
                    if (errorData.detail) {
                        userMessage = errorData.detail;
                    } else if (errorData.message) {
                        userMessage = errorData.message;
                    } else if (errorData.error) {
                        userMessage = errorData.error;
                    }
                    break;
            }
        }

        // If the API call fails, mark our transaction as FAILED (if DB is connected).
        if (isDbConnected()) {
            await Transaction.findOneAndUpdate({ externalReference }, { status: 'FAILED' });
        }
        return { success: false, message: userMessage, error: error.message };
    }
};

module.exports = { requestPayment };