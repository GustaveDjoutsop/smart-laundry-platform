const mongoose = require('mongoose');

const absenceSchema = new mongoose.Schema({
    employee: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['vacation', 'sick', 'personal', 'unpaid_leave', 'family_emergency', 'training'],
        required: true
    },
    startDate: {
        type: Date,
        required: true,
        index: true
    },
    endDate: {
        type: Date,
        required: true
    },
    reason: {
        type: String,
        trim: true,
        maxlength: 1000
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending',
        index: true
    },
    // Review information
    reviewedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    reviewedAt: {
        type: Date
    },
    reviewNotes: {
        type: String,
        trim: true,
        maxlength: 500
    },
    // Who created this absence request (usually the employee, but can be manager)
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Compound indexes for common queries
absenceSchema.index({ employee: 1, startDate: -1 });
absenceSchema.index({ status: 1, startDate: 1 });
absenceSchema.index({ startDate: 1, endDate: 1 });

/**
 * Virtual to calculate duration in days
 */
absenceSchema.virtual('durationDays').get(function() {
    if (!this.startDate || !this.endDate) return 0;
    const diffMs = this.endDate.getTime() - this.startDate.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end days
});

/**
 * Check if the absence period overlaps with another date range
 * @param {Date} start - Start of range to check
 * @param {Date} end - End of range to check
 * @returns {boolean}
 */
absenceSchema.methods.overlaps = function(start, end) {
    return this.startDate <= end && this.endDate >= start;
};

/**
 * Static method to check for overlapping absences
 * @param {ObjectId} employeeId - The employee's ID
 * @param {Date} startDate - Start date of new absence
 * @param {Date} endDate - End date of new absence
 * @param {ObjectId|null} excludeId - Absence ID to exclude (for updates)
 * @returns {Array} Overlapping absences
 */
absenceSchema.statics.findOverlapping = async function(employeeId, startDate, endDate, excludeId = null) {
    const query = {
        employee: employeeId,
        status: { $ne: 'rejected' }, // Don't count rejected absences
        $or: [
            // New absence starts during existing absence
            { startDate: { $lte: startDate }, endDate: { $gte: startDate } },
            // New absence ends during existing absence
            { startDate: { $lte: endDate }, endDate: { $gte: endDate } },
            // New absence completely contains existing absence
            { startDate: { $gte: startDate }, endDate: { $lte: endDate } }
        ]
    };

    if (excludeId) {
        query._id = { $ne: excludeId };
    }

    return this.find(query);
};

/**
 * Static method to get absences for a date range
 * @param {Object} filters - { employeeId, status, type, startDate, endDate }
 * @returns {Array} Absences matching filters
 */
absenceSchema.statics.getAbsences = async function(filters = {}) {
    const query = {};

    if (filters.employeeId) {
        query.employee = filters.employeeId;
    }

    if (filters.status) {
        query.status = filters.status;
    }

    if (filters.type) {
        query.type = filters.type;
    }

    if (filters.startDate && filters.endDate) {
        // Get absences that overlap with the date range
        query.$or = [
            { startDate: { $lte: filters.endDate }, endDate: { $gte: filters.startDate } }
        ];
    } else if (filters.startDate) {
        query.endDate = { $gte: filters.startDate };
    } else if (filters.endDate) {
        query.startDate = { $lte: filters.endDate };
    }

    return this.find(query)
        .populate('employee', 'name email role')
        .populate('reviewedBy', 'name email')
        .populate('createdBy', 'name email')
        .sort({ startDate: -1 });
};

/**
 * Static method to get pending absences count by employee
 * @returns {Array} Array of { employeeId, count }
 */
absenceSchema.statics.getPendingCountByEmployee = async function() {
    return this.aggregate([
        { $match: { status: 'pending' } },
        { $group: { _id: '$employee', count: { $sum: 1 } } },
        { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'employee' } },
        { $unwind: '$employee' },
        { $project: { employee: { name: 1, email: 1 }, count: 1 } }
    ]);
};

/**
 * Static method to get absence summary for an employee
 * @param {ObjectId} employeeId - The employee's ID
 * @param {number} year - Year to calculate summary for
 * @returns {Object} Summary by absence type
 */
absenceSchema.statics.getEmployeeSummary = async function(employeeId, year) {
    const startOfYear = new Date(year, 0, 1);
    const endOfYear = new Date(year, 11, 31, 23, 59, 59);

    const summary = await this.aggregate([
        {
            $match: {
                employee: new mongoose.Types.ObjectId(employeeId),
                status: 'approved',
                startDate: { $gte: startOfYear, $lte: endOfYear }
            }
        },
        {
            $project: {
                type: 1,
                durationDays: {
                    $add: [
                        {
                            $ceil: {
                                $divide: [
                                    { $subtract: ['$endDate', '$startDate'] },
                                    1000 * 60 * 60 * 24
                                ]
                            }
                        },
                        1
                    ]
                }
            }
        },
        {
            $group: {
                _id: '$type',
                totalDays: { $sum: '$durationDays' },
                count: { $sum: 1 }
            }
        }
    ]);

    // Convert to object keyed by type
    const result = {
        vacation: { totalDays: 0, count: 0 },
        sick: { totalDays: 0, count: 0 },
        personal: { totalDays: 0, count: 0 },
        unpaid_leave: { totalDays: 0, count: 0 },
        family_emergency: { totalDays: 0, count: 0 },
        training: { totalDays: 0, count: 0 }
    };

    for (const item of summary) {
        result[item._id] = {
            totalDays: item.totalDays,
            count: item.count
        };
    }

    return result;
};

/**
 * Approve this absence
 * @param {ObjectId} reviewerId - ID of the user approving
 * @param {string} notes - Optional review notes
 */
absenceSchema.methods.approve = async function(reviewerId, notes = '') {
    this.status = 'approved';
    this.reviewedBy = reviewerId;
    this.reviewedAt = new Date();
    this.reviewNotes = notes;
    await this.save();
};

/**
 * Reject this absence
 * @param {ObjectId} reviewerId - ID of the user rejecting
 * @param {string} notes - Required rejection reason
 */
absenceSchema.methods.reject = async function(reviewerId, notes) {
    if (!notes) {
        throw new Error('Rejection notes are required');
    }
    this.status = 'rejected';
    this.reviewedBy = reviewerId;
    this.reviewedAt = new Date();
    this.reviewNotes = notes;
    await this.save();
};

// Include virtuals in JSON output
absenceSchema.set('toJSON', {
    virtuals: true,
    transform: function(doc, ret) {
        delete ret.__v;
        return ret;
    }
});

absenceSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Absence', absenceSchema);
