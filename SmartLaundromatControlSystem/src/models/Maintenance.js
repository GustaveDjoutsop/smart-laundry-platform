const mongoose = require('mongoose');

const maintenanceSchema = new mongoose.Schema({
    machineId: {
        type: String,
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['preventive', 'corrective', 'emergency', 'inspection'],
        required: true
    },
    status: {
        type: String,
        enum: ['scheduled', 'in_progress', 'completed', 'cancelled'],
        default: 'scheduled'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'critical'],
        default: 'medium'
    },
    description: {
        type: String,
        required: true
    },
    notes: {
        type: String
    },
    scheduledDate: {
        type: Date
    },
    completedDate: {
        type: Date
    },
    performedBy: {
        type: String
    },
    cost: {
        type: Number,
        default: 0
    },
    partsReplaced: [{
        name: String,
        quantity: Number,
        cost: Number
    }],
    // For tracking alerts
    isAlert: {
        type: Boolean,
        default: false
    },
    alertAcknowledged: {
        type: Boolean,
        default: false
    },
    alertAcknowledgedAt: {
        type: Date
    },
    alertAcknowledgedBy: {
        type: String
    }
}, {
    timestamps: true
});

// Index for efficient queries
maintenanceSchema.index({ status: 1, scheduledDate: 1 });
maintenanceSchema.index({ machineId: 1, createdAt: -1 });

module.exports = mongoose.model('Maintenance', maintenanceSchema);
