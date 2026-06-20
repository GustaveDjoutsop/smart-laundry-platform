const mongoose = require('mongoose');

const expenseSchema = new mongoose.Schema({
    category: {
        type: String,
        enum: ['utilities', 'rent', 'salaries', 'maintenance', 'supplies', 'marketing', 'insurance', 'taxes', 'other'],
        required: true
    },
    description: {
        type: String,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },
    currency: {
        type: String,
        default: 'XAF'
    },
    date: {
        type: Date,
        required: true,
        index: true
    },
    paymentMethod: {
        type: String,
        enum: ['cash', 'bank_transfer', 'mobile_money', 'cheque', 'other'],
        default: 'cash'
    },
    vendor: {
        type: String
    },
    receiptNumber: {
        type: String
    },
    notes: {
        type: String
    },
    // For linking maintenance expenses
    maintenanceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Maintenance'
    },
    // For recurring expenses
    isRecurring: {
        type: Boolean,
        default: false
    },
    recurringFrequency: {
        type: String,
        enum: ['daily', 'weekly', 'monthly', 'quarterly', 'yearly']
    },
    createdBy: {
        type: String
    }
}, {
    timestamps: true
});

// Indexes for efficient queries
expenseSchema.index({ category: 1, date: -1 });
expenseSchema.index({ date: 1 });

module.exports = mongoose.model('Expense', expenseSchema);
