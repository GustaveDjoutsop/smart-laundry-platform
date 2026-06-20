const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    externalReference: {
        type: String,
        required: true,
        unique: true
    },
    amount: {
        type: Number,
        required: true
    },
    phoneNumber: {
        type: String,
        required: true
    },
    machineId: {
        type: String,
        required: true
    },
    pulseCount: {
        type: Number,
        required: true
    },
    cycleDuration: {
        type: Number, // Duration in minutes
        required: true
    },
    description: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['PENDING', 'SUCCESSFUL', 'FAILED', 'TIMEOUT'],
        default: 'PENDING'
    },
    cycleStatus: {
        type: String,
        enum: ['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED'],
        default: 'NOT_STARTED'
    },
    cycleStartedAt: {
        type: Date
    },
    cycleEndsAt: {
        type: Date
    },
    campayReference: {
        type: String
    },
    // MTN MoMo specific fields
    mtnReferenceId: {
        type: String
    },
    mtnTransactionId: {
        type: String
    },
    // Payment provider used for this transaction
    paymentProvider: {
        type: String,
        enum: ['campay', 'mtn'],
        default: 'campay'
    },
    // Failure reason from payment provider (when status is FAILED)
    failureReason: {
        type: String
    },
    // Timestamp when payment timed out (when status is TIMEOUT)
    timeoutAt: {
        type: Date
    },
    // Flag to track if cycle completion notification was sent
    cycleCompletedNotified: {
        type: Boolean,
        default: false
    },
    // Feedback tracking
    feedbackRequestedAt: {
        type: Date
    },
    feedbackRequestSent: {
        type: Boolean,
        default: false
    },
    // Customer feedback data
    feedback: {
        rating: {
            type: Number,
            min: 1,
            max: 5
        },
        comment: {
            type: String,
            maxlength: 200
        },
        submittedAt: {
            type: Date
        },
        staffAlertSent: {
            type: Boolean,
            default: false
        }
    }
}, {
    timestamps: true
});

// Virtual to check if cycle is still running
transactionSchema.virtual('isCycleRunning').get(function() {
    if (this.cycleStatus !== 'IN_PROGRESS') return false;
    if (!this.cycleEndsAt) return false;
    return new Date() < this.cycleEndsAt;
});

// Virtual to get remaining time in minutes
transactionSchema.virtual('remainingMinutes').get(function() {
    if (!this.isCycleRunning) return 0;
    const remaining = Math.ceil((this.cycleEndsAt - new Date()) / (1000 * 60));
    return Math.max(0, remaining);
});

module.exports = mongoose.model('Transaction', transactionSchema);
