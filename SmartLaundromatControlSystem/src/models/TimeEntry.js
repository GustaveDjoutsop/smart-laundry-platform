const mongoose = require('mongoose');

const timeEntrySchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['clock_in', 'clock_out'],
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    },
    method: {
        type: String,
        enum: ['manual', 'automatic', 'system'],
        default: 'automatic'
    },
    ipAddress: {
        type: String
    },
    userAgent: {
        type: String
    },
    notes: {
        type: String,
        trim: true,
        maxlength: 500
    },
    // For manual entries created by manager/admin
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    // Optional geolocation
    location: {
        lat: { type: Number },
        lng: { type: Number }
    }
}, {
    timestamps: true
});

// Compound indexes for common queries
timeEntrySchema.index({ employee: 1, timestamp: -1 });
timeEntrySchema.index({ employee: 1, type: 1, timestamp: -1 });
timeEntrySchema.index({ timestamp: -1 });

/**
 * Get the duration between this entry and the next one (for clock_in entries)
 * @param {Date} endTime - Optional end time, defaults to now
 * @returns {number} Duration in milliseconds
 */
timeEntrySchema.methods.getDuration = function(endTime = new Date()) {
    if (this.type !== 'clock_in') return 0;
    return endTime.getTime() - this.timestamp.getTime();
};

/**
 * Static method to get current clock status for an employee
 * @param {ObjectId} employeeId - The employee's ID
 * @returns {Object} { isClockedIn: boolean, lastEntry: TimeEntry|null }
 */
timeEntrySchema.statics.getClockStatus = async function(employeeId) {
    const lastEntry = await this.findOne({ employee: employeeId })
        .sort({ timestamp: -1 })
        .limit(1);

    return {
        isClockedIn: lastEntry?.type === 'clock_in',
        lastEntry
    };
};

/**
 * Static method to get time entries for a date range
 * @param {ObjectId|null} employeeId - Optional employee filter
 * @param {Date} startDate - Start of date range
 * @param {Date} endDate - End of date range
 * @returns {Array} Time entries
 */
timeEntrySchema.statics.getEntriesInRange = async function(employeeId, startDate, endDate) {
    const query = {
        timestamp: { $gte: startDate, $lte: endDate }
    };

    if (employeeId) {
        query.employee = employeeId;
    }

    return this.find(query)
        .populate('employee', 'name email role')
        .populate('createdBy', 'name email')
        .sort({ timestamp: -1 });
};

/**
 * Static method to calculate working hours summary
 * @param {ObjectId} employeeId - The employee's ID
 * @param {Date} startDate - Start of period
 * @param {Date} endDate - End of period
 * @returns {Object} { totalHours, totalMinutes, entries }
 */
timeEntrySchema.statics.calculateWorkingHours = async function(employeeId, startDate, endDate) {
    const entries = await this.find({
        employee: employeeId,
        timestamp: { $gte: startDate, $lte: endDate }
    }).sort({ timestamp: 1 });

    let totalMs = 0;
    let clockInTime = null;

    for (const entry of entries) {
        if (entry.type === 'clock_in') {
            clockInTime = entry.timestamp;
        } else if (entry.type === 'clock_out' && clockInTime) {
            totalMs += entry.timestamp.getTime() - clockInTime.getTime();
            clockInTime = null;
        }
    }

    // If still clocked in, count time until now (but not beyond endDate)
    if (clockInTime) {
        const now = new Date();
        const endTime = now < endDate ? now : endDate;
        totalMs += endTime.getTime() - clockInTime.getTime();
    }

    const totalMinutes = Math.floor(totalMs / 60000);
    const totalHours = Math.floor(totalMinutes / 60);
    const remainingMinutes = totalMinutes % 60;

    return {
        totalMs,
        totalMinutes,
        totalHours,
        remainingMinutes,
        formattedDuration: `${totalHours}h ${remainingMinutes}m`,
        entries
    };
};

/**
 * Static method to get paired entries (clock in + clock out pairs)
 * @param {ObjectId} employeeId - The employee's ID
 * @param {Date} startDate - Start of period
 * @param {Date} endDate - End of period
 * @returns {Array} Array of { clockIn, clockOut, duration } objects
 */
timeEntrySchema.statics.getPairedEntries = async function(employeeId, startDate, endDate) {
    const entries = await this.find({
        employee: employeeId,
        timestamp: { $gte: startDate, $lte: endDate }
    }).sort({ timestamp: 1 });

    const pairs = [];
    let currentClockIn = null;

    for (const entry of entries) {
        if (entry.type === 'clock_in') {
            currentClockIn = entry;
        } else if (entry.type === 'clock_out' && currentClockIn) {
            const durationMs = entry.timestamp.getTime() - currentClockIn.timestamp.getTime();
            pairs.push({
                clockIn: currentClockIn,
                clockOut: entry,
                durationMs,
                durationFormatted: formatDuration(durationMs)
            });
            currentClockIn = null;
        }
    }

    // Include open session (clocked in but not out)
    if (currentClockIn) {
        const now = new Date();
        const durationMs = now.getTime() - currentClockIn.timestamp.getTime();
        pairs.push({
            clockIn: currentClockIn,
            clockOut: null,
            durationMs,
            durationFormatted: formatDuration(durationMs),
            isOpen: true
        });
    }

    return pairs;
};

// Helper function to format duration
function formatDuration(ms) {
    const totalMinutes = Math.floor(ms / 60000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h ${minutes}m`;
}

// Remove __v from JSON output
timeEntrySchema.methods.toJSON = function() {
    const entry = this.toObject();
    delete entry.__v;
    return entry;
};

module.exports = mongoose.model('TimeEntry', timeEntrySchema);
