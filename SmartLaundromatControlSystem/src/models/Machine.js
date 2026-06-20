const mongoose = require('mongoose');

/**
 * Machine Schema - Stores telemetry data for washers and dryers
 * Simulates LG commercial laundry equipment
 */
const machineSchema = new mongoose.Schema({
    machineId: {
        type: String,
        required: true,
        unique: true
    },
    type: {
        type: String,
        enum: ['washer', 'dryer'],
        required: true
    },
    brand: {
        type: String,
        default: 'LG'
    },
    model: {
        type: String,
        default: 'Commercial Pro'
    },
    // Machine operational status
    status: {
        type: String,
        enum: ['IDLE', 'RUNNING', 'PAUSED', 'FINISHED', 'ERROR', 'MAINTENANCE', 'OFFLINE'],
        default: 'IDLE'
    },
    // Current cycle information
    currentCycle: {
        type: {
            type: String,
            enum: ['none', 'quick', 'normal', 'heavy', 'delicate', 'sanitize', 'low_heat', 'medium_heat', 'high_heat'],
            default: 'none'
        },
        startedAt: Date,
        duration: Number, // in minutes
        remainingTime: Number, // in minutes
        progress: { type: Number, default: 0 } // 0-100%
    },
    // Telemetry data
    telemetry: {
        temperature: { type: Number, default: 0 }, // Celsius
        humidity: { type: Number, default: 0 }, // Percentage (for dryers)
        waterLevel: { type: Number, default: 0 }, // Percentage (for washers)
        spinSpeed: { type: Number, default: 0 }, // RPM
        vibration: { type: Number, default: 0 }, // Intensity level 0-10
        doorOpen: { type: Boolean, default: false },
        powerConsumption: { type: Number, default: 0 }, // Watts
        waterUsage: { type: Number, default: 0 } // Liters (for washers)
    },
    // Error information
    errorCode: {
        type: String,
        default: null
    },
    errorMessage: {
        type: String,
        default: null
    },
    // Maintenance tracking
    maintenance: {
        lastServiceDate: Date,
        nextServiceDate: Date,
        totalCycles: { type: Number, default: 0 },
        cyclesSinceService: { type: Number, default: 0 }
    },
    // Connection status
    isOnline: {
        type: Boolean,
        default: true
    },
    lastHeartbeat: {
        type: Date,
        default: Date.now
    },
    // Location
    location: {
        zone: { type: String, default: 'main' },
        position: { type: Number, default: 1 }
    }
}, {
    timestamps: true
});

// Index for efficient queries (machineId index is already created by unique: true)
machineSchema.index({ type: 1, status: 1 });

// Virtual to check if machine is available for use
machineSchema.virtual('isAvailable').get(function() {
    return this.status === 'IDLE' && this.isOnline && !this.telemetry.doorOpen;
});

// Virtual to get display name
machineSchema.virtual('displayName').get(function() {
    const typeLabel = this.type === 'washer' ? 'Washer' : 'Dryer';
    const number = this.machineId.split('_')[1];
    return `${typeLabel} ${number}`;
});

module.exports = mongoose.model('Machine', machineSchema);
