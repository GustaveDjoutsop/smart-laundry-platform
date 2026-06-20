const { requestPayment } = require('../services/campayService');

/**
 * Initiates a payment for a laundry machine
 * Expected body: { phone, amount, machineId, pulseCount, description }
 */
exports.initiatePayment = async (req, res) => {
    const { phone, amount, machineId, pulseCount, description } = req.body;

    if (!phone || !amount || !machineId || !pulseCount) {
        return res.status(400).json({
            error: 'Missing required fields: phone, amount, machineId, pulseCount'
        });
    }

    const result = await requestPayment(
        phone,
        amount,
        description || `Payment for ${machineId}`,
        machineId,
        pulseCount
    );

    if (result.success) {
        return res.status(200).json({
            success: true,
            message: 'Payment initiated successfully',
            reference: result.reference,
            internalRef: result.internalRef
        });
    } else {
        return res.status(500).json({
            success: false,
            message: result.message || 'Failed to initiate payment'
        });
    }
};
