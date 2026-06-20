const mongoose = require('mongoose');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const config = require('../config/env');
const Transaction = require('../models/Transaction');

// Helper to check if MongoDB is actually connected
const isDbConnected = () => mongoose.connection.readyState === 1;

// Cache for access token
let cachedToken = null;
let tokenExpiry = null;

/**
 * Get OAuth2 access token from MTN MoMo API
 * Token is cached until expiry
 */
const getAccessToken = async () => {
    // Return cached token if still valid (with 60s buffer)
    if (cachedToken && tokenExpiry && Date.now() < tokenExpiry - 60000) {
        return cachedToken;
    }

    try {
        const credentials = Buffer.from(
            `${config.MTN_API_USER_ID}:${config.MTN_API_KEY}`
        ).toString('base64');

        const tokenUrl = `${config.MTN_API_URL}/collection/token/`;
        console.log(`🔐 MTN MoMo Auth [${config.MTN_ENV}]: ${tokenUrl}`);

        const response = await axios.post(tokenUrl, null, {
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Ocp-Apim-Subscription-Key': config.MTN_SUBSCRIPTION_KEY
            }
        });

        cachedToken = response.data.access_token;
        // Token expires in seconds, convert to ms and store absolute time
        tokenExpiry = Date.now() + (response.data.expires_in * 1000);

        console.log('✅ MTN MoMo token acquired successfully');
        return cachedToken;
    } catch (error) {
        console.error('❌ MTN MoMo Token Error:', error.response?.data || error.message);
        cachedToken = null;
        tokenExpiry = null;
        return null;
    }
};

/**
 * Format phone number for MTN MoMo API
 * MTN expects format: country code + number (e.g., 237xxxxxxxxx)
 * Cameroon numbers should be 237 + 9 digits (total 12 digits)
 * Mobile numbers in Cameroon start with 6 (e.g., 6xxxxxxxx)
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

/**
 * Request to Pay - Initiate a payment request to a customer
 * @param {string} phone - The user's phone number
 * @param {number} amount - The amount to charge
 * @param {string} description - A description for the payment
 * @param {string} machineId - The ID of the machine this payment is for
 * @param {number} pulseCount - The number of pulses to trigger on success
 * @param {number} cycleDuration - The duration of the wash cycle in minutes
 * @returns {Promise<object>} - An object indicating success and reference IDs
 */
const requestPayment = async (phone, amount, description, machineId, pulseCount, cycleDuration = 30) => {
    const token = await getAccessToken();
    if (!token) {
        return { success: false, message: "Authentication with MTN MoMo failed." };
    }

    const externalReference = uuidv4();
    const formattedPhone = formatPhoneNumber(phone);

    try {
        // Create a pending transaction record in our database FIRST
        if (isDbConnected()) {
            await Transaction.create({
                externalReference,
                amount,
                phoneNumber: phone,
                machineId,
                pulseCount,
                cycleDuration,
                description,
                status: 'PENDING',
                cycleStatus: 'NOT_STARTED',
                paymentProvider: 'mtn'
            });
        } else {
            console.log(`⚠️  Running without DB - Transaction ${externalReference} not persisted`);
        }

        // Request payment from MTN MoMo
        const requestToPayUrl = `${config.MTN_API_URL}/collection/v1_0/requesttopay`;
        console.log(`💳 MTN MoMo Request to Pay [${config.MTN_ENV}]: ${requestToPayUrl}`);

        // MTN MoMo requires X-Reference-Id header for idempotency
        const referenceId = uuidv4();

        // Determine target environment and currency
        // MTN sandbox only supports EUR, production uses XAF (Central African Franc)
        const isSandbox = config.MTN_ENV !== 'production';
        const targetEnv = isSandbox ? 'sandbox' : 'mtncameroon';
        const currency = isSandbox ? 'EUR' : 'XAF';

        console.log(`💱 MTN MoMo Currency: ${currency} (${isSandbox ? 'sandbox' : 'production'})`);

        await axios.post(requestToPayUrl, {
            amount: amount.toString(),
            currency: currency,
            externalId: externalReference,
            payer: {
                partyIdType: 'MSISDN',
                partyId: formattedPhone
            },
            payerMessage: description,
            payeeNote: `Smart Laundry - ${machineId}`
        }, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Reference-Id': referenceId,
                'X-Target-Environment': targetEnv,
                'Ocp-Apim-Subscription-Key': config.MTN_SUBSCRIPTION_KEY,
                'Content-Type': 'application/json'
            }
        });

        // Update transaction with MTN reference ID
        if (isDbConnected()) {
            await Transaction.findOneAndUpdate(
                { externalReference },
                { mtnReferenceId: referenceId }
            );
        }

        console.log(`✅ MTN MoMo payment request sent - Reference: ${referenceId}`);
        return { success: true, reference: referenceId, internalRef: externalReference };

    } catch (error) {
        console.error('❌ MTN MoMo Request to Pay Error:', error.response?.data || error.message);

        // Extract user-friendly error message
        let userMessage = "Failed to initiate payment.";
        if (error.response?.data) {
            const errorData = error.response.data;

            // Handle MTN MoMo error codes
            switch (errorData.code) {
                case 'PAYER_NOT_FOUND':
                    userMessage = "The phone number is not registered with MTN Mobile Money. Please check your number.";
                    break;
                case 'NOT_ALLOWED':
                    userMessage = "This transaction is not allowed. Please contact MTN support.";
                    break;
                case 'NOT_ALLOWED_TARGET_ENVIRONMENT':
                    userMessage = "Service temporarily unavailable. Please try again later.";
                    break;
                case 'INVALID_CALLBACK_URL_HOST':
                    userMessage = "Payment system configuration error. Please contact support.";
                    break;
                case 'INVALID_CURRENCY':
                    userMessage = "Currency not supported. Please contact support.";
                    break;
                case 'PAYEE_NOT_ALLOWED_TO_RECEIVE':
                    userMessage = "Unable to process payment. Please try again later.";
                    break;
                case 'PAYER_LIMIT_REACHED':
                    userMessage = "You have reached your daily transaction limit. Please try again tomorrow.";
                    break;
                case 'NOT_ENOUGH_FUNDS':
                    userMessage = "Insufficient funds in your MTN Mobile Money account.";
                    break;
                default:
                    if (errorData.message) {
                        userMessage = errorData.message;
                    }
                    break;
            }
        }

        // Mark transaction as FAILED
        if (isDbConnected()) {
            await Transaction.findOneAndUpdate({ externalReference }, { status: 'FAILED' });
        }

        return { success: false, message: userMessage, error: error.message };
    }
};

/**
 * Check the status of a payment request
 * @param {string} referenceId - The X-Reference-Id from the original request
 * @returns {Promise<object>} - Payment status information
 */
const getPaymentStatus = async (referenceId) => {
    const token = await getAccessToken();
    if (!token) {
        return { success: false, message: "Authentication with MTN MoMo failed." };
    }

    try {
        const targetEnv = config.MTN_ENV === 'production' ? 'mtncameroon' : 'sandbox';
        const statusUrl = `${config.MTN_API_URL}/collection/v1_0/requesttopay/${referenceId}`;

        const response = await axios.get(statusUrl, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'X-Target-Environment': targetEnv,
                'Ocp-Apim-Subscription-Key': config.MTN_SUBSCRIPTION_KEY
            }
        });

        return {
            success: true,
            status: response.data.status,
            data: response.data
        };
    } catch (error) {
        console.error('❌ MTN MoMo Status Check Error:', error.response?.data || error.message);
        return { success: false, message: "Failed to check payment status.", error: error.message };
    }
};

module.exports = { requestPayment, getPaymentStatus, getAccessToken };
