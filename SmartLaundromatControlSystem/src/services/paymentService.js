const config = require('../config/env');
const campayService = require('./campayService');
const mtnService = require('./mtnService');

/**
 * Unified Payment Service
 * Switches between Campay and MTN MoMo based on PAYMENT_PROVIDER config
 */

/**
 * Get the currently active payment provider name
 * @returns {string} - 'campay' or 'mtn'
 */
const getActiveProvider = () => {
    const provider = config.PAYMENT_PROVIDER?.toLowerCase() || 'campay';
    return ['campay', 'mtn'].includes(provider) ? provider : 'campay';
};

/**
 * Request a payment from the active provider
 * @param {string} phone - The user's phone number
 * @param {number} amount - The amount to charge
 * @param {string} description - A description for the payment
 * @param {string} machineId - The ID of the machine this payment is for
 * @param {number} pulseCount - The number of pulses to trigger on success
 * @param {number} cycleDuration - The duration of the wash cycle in minutes
 * @returns {Promise<object>} - An object indicating success and reference IDs
 */
const requestPayment = async (phone, amount, description, machineId, pulseCount, cycleDuration = 30) => {
    const provider = getActiveProvider();
    console.log(`💳 Payment Provider: ${provider.toUpperCase()}`);

    try {
        if (provider === 'mtn') {
            return await mtnService.requestPayment(phone, amount, description, machineId, pulseCount, cycleDuration);
        } else {
            return await campayService.requestPayment(phone, amount, description, machineId, pulseCount, cycleDuration);
        }
    } catch (error) {
        console.error(`❌ Payment Error [${provider}]:`, error.message);
        return {
            success: false,
            message: "Payment service temporarily unavailable. Please try again later.",
            error: error.message
        };
    }
};

/**
 * Check if the payment service is properly configured
 * @returns {object} - Configuration status for each provider
 */
const getProviderStatus = () => {
    const activeProvider = getActiveProvider();

    const campayConfigured = !!(config.CAMPAY_KEY && config.CAMPAY_SECRET);
    const mtnConfigured = !!(config.MTN_SUBSCRIPTION_KEY && config.MTN_API_USER_ID && config.MTN_API_KEY);

    return {
        activeProvider,
        providers: {
            campay: {
                configured: campayConfigured,
                active: activeProvider === 'campay'
            },
            mtn: {
                configured: mtnConfigured,
                active: activeProvider === 'mtn'
            }
        }
    };
};

module.exports = {
    requestPayment,
    getActiveProvider,
    getProviderStatus
};
