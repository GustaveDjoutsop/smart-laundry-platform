const mqtt = require('mqtt');
const mongoose = require('mongoose');
const config = require('../config/env');
const Machine = require('../models/Machine');
const { log } = require('../utils/logger');

let client;

// Telemetry message handlers
const telemetryHandlers = [];

// Command handlers (for routing commands to embedded simulator in TEST env)
const commandHandlers = [];

// ============================================
// MQTT Validation Functions
// ============================================

/**
 * Validate machine ID against whitelist
 * @param {string} machineId - Machine identifier
 * @returns {boolean} True if valid
 */
function validateMachineId(machineId) {
    if (!machineId || typeof machineId !== 'string') {
        log.warn('Invalid machineId: must be a non-empty string', { machineId });
        return false;
    }

    const validMachines = config.MACHINES.AVAILABLE_MACHINES || [];
    if (validMachines.length === 0) {
        // If no whitelist configured, allow all (development mode)
        return true;
    }

    const isValid = validMachines.includes(machineId);
    if (!isValid) {
        log.warn('Machine ID not in whitelist', { machineId, whitelist: validMachines });
    }
    return isValid;
}

/**
 * Validate pulse count
 * @param {number} pulses - Number of pulses
 * @returns {boolean} True if valid
 */
function validatePulseCount(pulses) {
    // Convert to number
    const count = Number(pulses);

    // Reject NaN, non-integers, and out of range
    if (isNaN(count) || !Number.isInteger(count) || count < 1 || count > 10) {
        log.warn('Invalid pulse count: must be an integer between 1 and 10', { pulses });
        return false;
    }

    // Additional safety: reject if original input contained non-numeric characters
    // This prevents injection attempts like "5; rm -rf /"
    const stringValue = String(pulses).trim();
    if (!/^-?\d+$/.test(stringValue)) {
        log.warn('Invalid pulse count: contains non-numeric characters', { pulses });
        return false;
    }

    return true;
}

/**
 * Validate MQTT action
 * @param {string} action - Action name
 * @returns {boolean} True if valid
 */
function validateAction(action) {
    const allowedActions = ['pulse', 'status', 'stop', 'reset'];
    if (!allowedActions.includes(action)) {
        log.warn('Invalid MQTT action', { action, allowed: allowedActions });
        return false;
    }
    return true;
}

/**
 * Register a handler for telemetry updates
 */
const onTelemetry = (handler) => {
    telemetryHandlers.push(handler);
};

/**
 * Register a handler for commands (used by embedded simulator)
 */
const onCommand = (handler) => {
    commandHandlers.push(handler);
};

/**
 * Process incoming telemetry data
 */
const processTelemetry = async (machineId, data) => {
    try {
        // Only store in DB if connected
        if (mongoose.connection.readyState === 1) {
            await Machine.findOneAndUpdate(
                { machineId },
                {
                    $set: {
                        machineId: data.machineId,
                        type: data.type,
                        brand: data.brand,
                        model: data.model,
                        status: data.status,
                        currentCycle: data.currentCycle,
                        telemetry: data.telemetry,
                        errorCode: data.errorCode,
                        errorMessage: data.errorMessage,
                        'maintenance.totalCycles': data.maintenance?.totalCycles,
                        'maintenance.cyclesSinceService': data.maintenance?.cyclesSinceService,
                        isOnline: data.isOnline,
                        lastHeartbeat: data.lastHeartbeat,
                        'location.zone': data.location?.zone,
                        'location.position': data.location?.position
                    }
                },
                { upsert: true, new: true }
            );
        }

        // Notify all registered handlers
        telemetryHandlers.forEach(handler => {
            try {
                handler(machineId, data);
            } catch (err) {
                log.error('Telemetry handler error', { machineId, error: err.message });
            }
        });
    } catch (err) {
        log.error('Error processing telemetry', { machineId, error: err.message });
    }
};

const connectMQTT = () => {
    // Skip MQTT connection in test environment
    if (config.IS_TEST) {
        log.info('Skipping MQTT connection in test environment');
        return;
    }

    // Build MQTT connection options with authentication if credentials are provided
    const options = {
        clientId: `laundry_backend_${Math.random().toString(16).substring(2, 10)}`,
        clean: true,
        reconnectPeriod: 1000,
    };

    // Add authentication if credentials are provided (for stage/production)
    if (config.MQTT_USERNAME && config.MQTT_PASSWORD) {
        options.username = config.MQTT_USERNAME;
        options.password = config.MQTT_PASSWORD;
        log.mqtt('Connecting with authentication', { environment: config.NODE_ENV });
    } else {
        log.mqtt('Connecting without authentication', { environment: config.NODE_ENV });
    }

    client = mqtt.connect(config.MQTT_BROKER, options);

    client.on('connect', () => {
        log.mqtt('Connected successfully', { broker: config.MQTT_BROKER });

        // Subscribe to telemetry topics for all machines
        const telemetryTopic = 'laundry/cameroon/+/telemetry';
        client.subscribe(telemetryTopic, { qos: 1 }, (err) => {
            if (!err) {
                log.mqtt('Subscribed to telemetry', { topic: telemetryTopic });
            } else {
                log.error('Failed to subscribe to telemetry', { topic: telemetryTopic, error: err.message });
            }
        });
    });

    client.on('message', (topic, message) => {
        try {
            // Parse telemetry messages
            if (topic.includes('/telemetry')) {
                const parts = topic.split('/');
                const machineId = parts[2];
                const data = JSON.parse(message.toString());
                processTelemetry(machineId, data);
            }
        } catch (err) {
            log.error('Error processing MQTT message', { topic, error: err.message });
        }
    });

    client.on('error', (err) => {
        log.error('MQTT connection error', { error: err.message });
    });

    client.on('close', () => {
        log.warn('MQTT connection closed');
    });
};

const triggerPulse = (machineId, pulses) => {
    // Validate inputs
    if (!validateMachineId(machineId)) {
        log.error('Invalid machine ID for pulse trigger', { machineId });
        return false;
    }

    if (!validatePulseCount(pulses)) {
        log.error('Invalid pulse count', { machineId, pulses });
        return false;
    }

    const command = { action: "pulse", count: pulses };

    // Publish via MQTT if client is connected
    if (client && client.connected) {
        const topic = `laundry/cameroon/${machineId}/command`;
        const payload = JSON.stringify(command);
        client.publish(topic, payload, { qos: 1 });
        log.mqtt('Pulse sent via MQTT', { machineId, pulses });
    }

    // Also notify command handlers (for embedded simulator in TEST env)
    commandHandlers.forEach(handler => {
        try {
            handler(machineId, command);
        } catch (err) {
            log.error('Command handler error', { machineId, error: err.message });
        }
    });

    if (commandHandlers.length > 0) {
        log.mqtt('Pulse sent to simulator', { machineId, pulses });
    }

    return true;
};

/**
 * Send a command to a specific machine
 */
const sendCommand = (machineId, action, params = {}) => {
    // Validate inputs
    if (!validateMachineId(machineId)) {
        log.error('Invalid machine ID for command', { machineId, action });
        return false;
    }

    if (!validateAction(action)) {
        log.error('Invalid action for command', { machineId, action });
        return false;
    }

    if (!client) {
        log.warn('MQTT client not connected', { machineId, action });
        return false;
    }

    const topic = `laundry/cameroon/${machineId}/command`;
    const payload = JSON.stringify({ action, ...params });
    client.publish(topic, payload, { qos: 1 });
    log.mqtt('Command sent', { machineId, action, params });
    return true;
};

/**
 * Get all machines from the database
 */
const getAllMachines = async () => {
    if (mongoose.connection.readyState !== 1) return [];
    return Machine.find({}).sort({ type: 1, machineId: 1 });
};

/**
 * Get machines by type (washer/dryer)
 */
const getMachinesByType = async (type) => {
    if (mongoose.connection.readyState !== 1) return [];
    return Machine.find({ type }).sort({ machineId: 1 });
};

/**
 * Get available machines (IDLE and online)
 */
const getAvailableMachines = async (type = null) => {
    if (mongoose.connection.readyState !== 1) return [];
    const query = { status: 'IDLE', isOnline: true, 'telemetry.doorOpen': false };
    if (type) query.type = type;
    return Machine.find(query).sort({ machineId: 1 });
};

/**
 * Handle simulated telemetry from embedded simulator (TEST environment)
 * Bypasses MQTT and directly processes telemetry data
 */
const handleSimulatedTelemetry = (machineId, data) => {
    processTelemetry(machineId, data);
};

module.exports = {
    connectMQTT,
    triggerPulse,
    sendCommand,
    onTelemetry,
    onCommand,
    getAllMachines,
    getMachinesByType,
    getAvailableMachines,
    handleSimulatedTelemetry,
    // Export for testing
    _validateMachineId: validateMachineId,
    _validatePulseCount: validatePulseCount,
    _validateAction: validateAction
};