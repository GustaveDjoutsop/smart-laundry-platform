/**
 * Business Hours Utility
 * Checks if the laundromat is open and if cycles can complete before closing
 */

const config = require('../config/env');

/**
 * Parse time string (HH:MM) to minutes since midnight
 */
const parseTimeToMinutes = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
};

/**
 * Get current time in business timezone as minutes since midnight
 */
const getCurrentTimeMinutes = () => {
    const now = new Date();
    // Use timezone-aware formatting to get local time in business timezone
    const options = {
        timeZone: config.BUSINESS_HOURS.TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };
    const timeStr = now.toLocaleTimeString('en-US', options);
    return parseTimeToMinutes(timeStr);
};

/**
 * Get current time formatted for display
 */
const getCurrentTimeFormatted = () => {
    const now = new Date();
    const options = {
        timeZone: config.BUSINESS_HOURS.TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    };
    return now.toLocaleTimeString('en-US', options);
};

/**
 * Check if the laundromat is currently open
 */
const isOpen = () => {
    const currentMinutes = getCurrentTimeMinutes();
    const openMinutes = parseTimeToMinutes(config.BUSINESS_HOURS.OPEN_TIME);
    const closeMinutes = parseTimeToMinutes(config.BUSINESS_HOURS.CLOSE_TIME);

    return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
};

/**
 * Check if a cycle of given duration can complete before closing
 * @param {number} cycleDurationMinutes - Duration of the wash/dry cycle in minutes
 * @returns {object} - { allowed: boolean, reason: string, lastAllowedTime: string }
 */
const canStartCycle = (cycleDurationMinutes) => {
    const currentMinutes = getCurrentTimeMinutes();
    const openMinutes = parseTimeToMinutes(config.BUSINESS_HOURS.OPEN_TIME);
    const closeMinutes = parseTimeToMinutes(config.BUSINESS_HOURS.CLOSE_TIME);
    const bufferMinutes = config.BUSINESS_HOURS.CLOSING_BUFFER_MINUTES;

    // Calculate when the cycle would end
    const cycleEndMinutes = currentMinutes + cycleDurationMinutes;

    // Calculate the latest time a cycle can end (closing time minus buffer)
    const latestEndMinutes = closeMinutes - bufferMinutes;

    // Calculate the last allowed start time for this cycle duration
    const lastAllowedStartMinutes = latestEndMinutes - cycleDurationMinutes;

    // Format last allowed time for display
    const lastAllowedHours = Math.floor(lastAllowedStartMinutes / 60);
    const lastAllowedMins = lastAllowedStartMinutes % 60;
    const lastAllowedTime = `${lastAllowedHours.toString().padStart(2, '0')}:${lastAllowedMins.toString().padStart(2, '0')}`;

    // Check if we're before opening time
    if (currentMinutes < openMinutes) {
        return {
            allowed: false,
            reason: 'before_opening',
            openTime: config.BUSINESS_HOURS.OPEN_TIME,
            closeTime: config.BUSINESS_HOURS.CLOSE_TIME
        };
    }

    // Check if we're after closing time
    if (currentMinutes >= closeMinutes) {
        return {
            allowed: false,
            reason: 'after_closing',
            openTime: config.BUSINESS_HOURS.OPEN_TIME,
            closeTime: config.BUSINESS_HOURS.CLOSE_TIME
        };
    }

    // Check if cycle would end after closing (with buffer)
    if (cycleEndMinutes > latestEndMinutes) {
        return {
            allowed: false,
            reason: 'cycle_exceeds_closing',
            cycleDuration: cycleDurationMinutes,
            closeTime: config.BUSINESS_HOURS.CLOSE_TIME,
            lastAllowedTime: lastAllowedTime,
            currentTime: getCurrentTimeFormatted()
        };
    }

    // Cycle can start
    return {
        allowed: true,
        reason: 'ok'
    };
};

/**
 * Get business hours info for display
 */
const getBusinessHoursInfo = () => {
    return {
        openTime: config.BUSINESS_HOURS.OPEN_TIME,
        closeTime: config.BUSINESS_HOURS.CLOSE_TIME,
        timezone: config.BUSINESS_HOURS.TIMEZONE,
        isCurrentlyOpen: isOpen(),
        currentTime: getCurrentTimeFormatted()
    };
};

module.exports = {
    isOpen,
    canStartCycle,
    getBusinessHoursInfo,
    getCurrentTimeFormatted,
    parseTimeToMinutes,
    getCurrentTimeMinutes
};
