const { triggerPulse } = require('../services/mqttService');

/**
 * Triggers a machine to start operating by sending MQTT pulses
 * @param {string} machineId - The ID of the machine to trigger
 * @param {number} pulseCount - The number of pulses to send
 */
const triggerMachine = (machineId, pulseCount) => {
    triggerPulse(machineId, pulseCount);
};

module.exports = { triggerMachine };
