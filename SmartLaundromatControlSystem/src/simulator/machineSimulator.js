/**
 * LG Laundry Machine Telemetry Simulator
 *
 * Simulates 6 washers and 4 dryers with realistic telemetry data.
 * Publishes data via MQTT to the local broker.
 *
 * Usage: npm run simulator
 */

const mqtt = require('mqtt');
require('dotenv').config({ override: true });
const { log } = require('../utils/logger');

// Configuration
const MQTT_BROKER = process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883';
const TELEMETRY_INTERVAL = 5000; // 5 seconds
const BASE_TOPIC = 'laundry/cameroon';

// Machine definitions
const MACHINES = {
    washers: [
        { id: 'washer_01', model: 'LG WM3900HWA', zone: 'main', position: 1 },
        { id: 'washer_02', model: 'LG WM3900HWA', zone: 'main', position: 2 },
        { id: 'washer_03', model: 'LG WM4500HBA', zone: 'main', position: 3 },
        { id: 'washer_04', model: 'LG WM4500HBA', zone: 'main', position: 4 },
        { id: 'washer_05', model: 'LG WM8100HVA', zone: 'secondary', position: 1 },
        { id: 'washer_06', model: 'LG WM8100HVA', zone: 'secondary', position: 2 }
    ],
    dryers: [
        { id: 'dryer_01', model: 'LG DLEX3900W', zone: 'main', position: 1 },
        { id: 'dryer_02', model: 'LG DLEX3900W', zone: 'main', position: 2 },
        { id: 'dryer_03', model: 'LG DLEX4500B', zone: 'secondary', position: 1 },
        { id: 'dryer_04', model: 'LG DLEX4500B', zone: 'secondary', position: 2 }
    ]
};

// Possible machine statuses
const STATUSES = ['IDLE', 'RUNNING', 'PAUSED', 'FINISHED', 'ERROR', 'MAINTENANCE', 'OFFLINE'];

// Washer cycle types
const WASHER_CYCLES = ['none', 'quick', 'normal', 'heavy', 'delicate', 'sanitize'];

// Dryer cycle types
const DRYER_CYCLES = ['none', 'low_heat', 'medium_heat', 'high_heat', 'delicate', 'quick'];

// Error codes for simulation
const ERROR_CODES = {
    washer: [
        { code: 'OE', message: 'Drain error - Water not draining properly' },
        { code: 'UE', message: 'Unbalanced load detected' },
        { code: 'DE', message: 'Door error - Door not properly closed' },
        { code: 'FE', message: 'Water overflow error' },
        { code: 'PE', message: 'Water pressure sensor error' },
        { code: 'LE', message: 'Motor locked - Overload detected' }
    ],
    dryer: [
        { code: 'D80', message: 'Exhaust blockage 80% - Clean lint filter' },
        { code: 'D90', message: 'Exhaust blockage 90% - Service required' },
        { code: 'TE1', message: 'Thermistor error - Temperature sensor fault' },
        { code: 'PS', message: 'Power supply error' },
        { code: 'F1', message: 'Main PCB communication error' }
    ]
};

// Machine state management
const machineStates = new Map();

/**
 * Initialize machine states
 */
function initializeMachines() {
    // Initialize washers
    MACHINES.washers.forEach(washer => {
        machineStates.set(washer.id, {
            ...washer,
            type: 'washer',
            brand: 'LG',
            status: 'IDLE',
            currentCycle: {
                type: 'none',
                startedAt: null,
                duration: 0,
                remainingTime: 0,
                progress: 0
            },
            telemetry: {
                temperature: 20,
                waterLevel: 0,
                spinSpeed: 0,
                vibration: 0,
                doorOpen: false,
                powerConsumption: 5,
                waterUsage: 0
            },
            errorCode: null,
            errorMessage: null,
            maintenance: {
                totalCycles: Math.floor(Math.random() * 1000) + 100,
                cyclesSinceService: Math.floor(Math.random() * 100)
            },
            isOnline: true,
            lastHeartbeat: new Date()
        });
    });

    // Initialize dryers
    MACHINES.dryers.forEach(dryer => {
        machineStates.set(dryer.id, {
            ...dryer,
            type: 'dryer',
            brand: 'LG',
            status: 'IDLE',
            currentCycle: {
                type: 'none',
                startedAt: null,
                duration: 0,
                remainingTime: 0,
                progress: 0
            },
            telemetry: {
                temperature: 25,
                humidity: 40,
                spinSpeed: 0,
                vibration: 0,
                doorOpen: false,
                powerConsumption: 5,
                exhaustFlow: 100
            },
            errorCode: null,
            errorMessage: null,
            maintenance: {
                totalCycles: Math.floor(Math.random() * 800) + 50,
                cyclesSinceService: Math.floor(Math.random() * 80)
            },
            isOnline: true,
            lastHeartbeat: new Date()
        });
    });

    log.info('Initialized machines', {
        washers: MACHINES.washers.length,
        dryers: MACHINES.dryers.length
    });
}

/**
 * Simulate random events (status changes, errors, etc.)
 */
function simulateRandomEvents() {
    machineStates.forEach((state, machineId) => {
        // Skip if machine is in error or maintenance
        if (state.status === 'ERROR' || state.status === 'MAINTENANCE') {
            // 5% chance to recover from error
            if (Math.random() < 0.05) {
                state.status = 'IDLE';
                state.errorCode = null;
                state.errorMessage = null;
                log.info('Machine recovered', { machineId, fromStatus: state.status });
            }
            return;
        }

        // 2% chance for an IDLE machine to start a cycle
        if (state.status === 'IDLE' && Math.random() < 0.02) {
            startCycle(machineId);
        }

        // 1% chance for a machine to go into error
        if (state.status === 'RUNNING' && Math.random() < 0.01) {
            triggerError(machineId);
        }

        // 0.5% chance for maintenance mode
        if (state.status === 'IDLE' && Math.random() < 0.005) {
            state.status = 'MAINTENANCE';
            log.info('Machine entered maintenance mode', { machineId });
        }

        // 1% chance for door to be opened (if idle)
        if (state.status === 'IDLE') {
            state.telemetry.doorOpen = Math.random() < 0.1;
        }
    });
}

/**
 * Start a wash/dry cycle
 */
function startCycle(machineId) {
    const state = machineStates.get(machineId);
    if (!state || state.status !== 'IDLE') return;

    const isWasher = state.type === 'washer';
    const cycles = isWasher ? WASHER_CYCLES.filter(c => c !== 'none') : DRYER_CYCLES.filter(c => c !== 'none');
    const cycleType = cycles[Math.floor(Math.random() * cycles.length)];

    // Duration based on cycle type (in minutes, but we'll simulate faster)
    const durations = {
        quick: 3,      // 30 mins simulated as 3 mins
        normal: 5,     // 50 mins simulated as 5 mins
        heavy: 7,      // 70 mins simulated as 7 mins
        delicate: 4,   // 40 mins simulated as 4 mins
        sanitize: 8,   // 80 mins simulated as 8 mins
        low_heat: 4,
        medium_heat: 5,
        high_heat: 6
    };

    const duration = durations[cycleType] || 5;

    state.status = 'RUNNING';
    state.currentCycle = {
        type: cycleType,
        startedAt: new Date(),
        duration: duration,
        remainingTime: duration,
        progress: 0
    };
    state.telemetry.doorOpen = false;
    state.maintenance.totalCycles++;
    state.maintenance.cyclesSinceService++;

    log.info('Machine cycle started', { machineId, cycleType, duration });
}

/**
 * Update running cycles
 */
function updateRunningCycles() {
    machineStates.forEach((state, machineId) => {
        if (state.status !== 'RUNNING') return;

        const cycle = state.currentCycle;
        const elapsed = (Date.now() - new Date(cycle.startedAt).getTime()) / 60000; // minutes
        const progress = Math.min(100, (elapsed / cycle.duration) * 100);
        const remaining = Math.max(0, cycle.duration - elapsed);

        cycle.progress = Math.round(progress);
        cycle.remainingTime = Math.round(remaining * 10) / 10;

        // Update telemetry based on cycle phase
        updateTelemetry(state, progress);

        // Check if cycle completed
        if (progress >= 100) {
            state.status = 'FINISHED';
            state.currentCycle.type = 'none';
            state.currentCycle.progress = 100;
            state.currentCycle.remainingTime = 0;
            resetTelemetry(state);
            log.info('Machine finished cycle', { machineId });

            // Auto-return to IDLE after 30 seconds (simulated)
            setTimeout(() => {
                if (machineStates.get(machineId)?.status === 'FINISHED') {
                    machineStates.get(machineId).status = 'IDLE';
                    log.info('Machine returned to IDLE', { machineId });
                }
            }, 30000);
        }
    });
}

/**
 * Update telemetry based on cycle progress
 */
function updateTelemetry(state, progress) {
    const isWasher = state.type === 'washer';

    if (isWasher) {
        // Washer telemetry simulation
        if (progress < 20) {
            // Filling phase
            state.telemetry.waterLevel = Math.min(80, progress * 4);
            state.telemetry.temperature = 20 + progress;
            state.telemetry.spinSpeed = 0;
        } else if (progress < 60) {
            // Washing phase
            state.telemetry.waterLevel = 80;
            state.telemetry.temperature = 40 + Math.random() * 10;
            state.telemetry.spinSpeed = 50 + Math.random() * 30;
            state.telemetry.vibration = 2 + Math.random() * 2;
        } else if (progress < 80) {
            // Rinsing phase
            state.telemetry.waterLevel = 60 + Math.random() * 20;
            state.telemetry.temperature = 30 + Math.random() * 5;
            state.telemetry.spinSpeed = 100 + Math.random() * 50;
        } else {
            // Spinning phase
            state.telemetry.waterLevel = Math.max(0, 80 - (progress - 80) * 4);
            state.telemetry.spinSpeed = 800 + Math.random() * 400;
            state.telemetry.vibration = 5 + Math.random() * 3;
        }
        state.telemetry.powerConsumption = 500 + Math.random() * 1500;
        state.telemetry.waterUsage = progress * 0.5; // liters
    } else {
        // Dryer telemetry simulation
        const cycleType = state.currentCycle.type;
        const targetTemp = cycleType === 'high_heat' ? 70 : cycleType === 'medium_heat' ? 55 : 40;

        if (progress < 20) {
            // Heating up phase
            state.telemetry.temperature = 25 + (targetTemp - 25) * (progress / 20);
            state.telemetry.humidity = 60 + Math.random() * 10;
        } else if (progress < 90) {
            // Main drying phase
            state.telemetry.temperature = targetTemp + Math.random() * 5 - 2.5;
            state.telemetry.humidity = Math.max(20, 70 - progress * 0.5);
        } else {
            // Cooldown phase
            state.telemetry.temperature = targetTemp - (progress - 90) * 3;
            state.telemetry.humidity = 20 + Math.random() * 5;
        }
        state.telemetry.spinSpeed = progress > 10 && progress < 95 ? 50 + Math.random() * 20 : 0;
        state.telemetry.vibration = state.telemetry.spinSpeed > 0 ? 1 + Math.random() * 2 : 0;
        state.telemetry.powerConsumption = 2000 + Math.random() * 1000;
        state.telemetry.exhaustFlow = 80 + Math.random() * 20;
    }
}

/**
 * Reset telemetry to idle state
 */
function resetTelemetry(state) {
    const isWasher = state.type === 'washer';

    if (isWasher) {
        state.telemetry = {
            temperature: 20,
            waterLevel: 0,
            spinSpeed: 0,
            vibration: 0,
            doorOpen: false,
            powerConsumption: 5,
            waterUsage: 0
        };
    } else {
        state.telemetry = {
            temperature: 25,
            humidity: 40,
            spinSpeed: 0,
            vibration: 0,
            doorOpen: false,
            powerConsumption: 5,
            exhaustFlow: 100
        };
    }
}

/**
 * Trigger an error on a machine
 */
function triggerError(machineId) {
    const state = machineStates.get(machineId);
    if (!state) return;

    const errors = ERROR_CODES[state.type];
    const error = errors[Math.floor(Math.random() * errors.length)];

    state.status = 'ERROR';
    state.errorCode = error.code;
    state.errorMessage = error.message;
    resetTelemetry(state);

    log.error('Machine error', {
        machineId,
        errorCode: error.code,
        message: error.message
    });
}

/**
 * Publish telemetry data via MQTT
 */
function publishTelemetry(client) {
    machineStates.forEach((state, machineId) => {
        state.lastHeartbeat = new Date();

        const telemetryData = {
            machineId: state.id,
            type: state.type,
            brand: state.brand,
            model: state.model,
            status: state.status,
            currentCycle: state.currentCycle,
            telemetry: state.telemetry,
            errorCode: state.errorCode,
            errorMessage: state.errorMessage,
            maintenance: state.maintenance,
            isOnline: state.isOnline,
            lastHeartbeat: state.lastHeartbeat.toISOString(),
            location: { zone: state.zone, position: state.position },
            timestamp: new Date().toISOString()
        };

        const topic = `${BASE_TOPIC}/${machineId}/telemetry`;
        client.publish(topic, JSON.stringify(telemetryData), { qos: 1 });
    });
}

/**
 * Handle incoming commands from the backend
 */
function handleCommand(client, topic, message) {
    try {
        const parts = topic.split('/');
        const machineId = parts[2];
        const command = JSON.parse(message.toString());

        log.info('Command received', { machineId, command });

        const state = machineStates.get(machineId);
        if (!state) {
            log.warn('Unknown machine', { machineId });
            return;
        }

        switch (command.action) {
            case 'pulse':
                // Simulate receiving pulse command from backend
                if (state.status === 'IDLE') {
                    startCycle(machineId);
                }
                break;
            case 'start':
                if (state.status === 'IDLE') {
                    startCycle(machineId);
                }
                break;
            case 'stop':
                if (state.status === 'RUNNING') {
                    state.status = 'IDLE';
                    state.currentCycle.type = 'none';
                    resetTelemetry(state);
                    log.info('Machine stopped', { machineId });
                }
                break;
            case 'pause':
                if (state.status === 'RUNNING') {
                    state.status = 'PAUSED';
                    log.info('Machine paused', { machineId });
                }
                break;
            case 'resume':
                if (state.status === 'PAUSED') {
                    state.status = 'RUNNING';
                    log.info('Machine resumed', { machineId });
                }
                break;
            case 'reset':
                state.status = 'IDLE';
                state.errorCode = null;
                state.errorMessage = null;
                resetTelemetry(state);
                log.info('Machine reset', { machineId });
                break;
            default:
                log.warn('Unknown command', { action: command.action });
        }
    } catch (err) {
        log.error('Error handling command', { error: err.message });
    }
}

/**
 * Main simulator function
 */
function startSimulator() {
    log.info('Starting LG Laundry Machine Simulator');
    log.info('Connecting to MQTT broker', { broker: MQTT_BROKER });

    const client = mqtt.connect(MQTT_BROKER, {
        clientId: `laundry_simulator_${Math.random().toString(16).substring(2, 8)}`,
        clean: true,
        reconnectPeriod: 5000
    });

    client.on('connect', () => {
        log.info('Connected to MQTT broker');

        // Initialize machines
        initializeMachines();

        // Subscribe to command topics for all machines
        const allMachines = [...MACHINES.washers, ...MACHINES.dryers];
        allMachines.forEach(machine => {
            const commandTopic = `${BASE_TOPIC}/${machine.id}/command`;
            client.subscribe(commandTopic, (err) => {
                if (!err) {
                    log.info('Subscribed to command topic', { topic: commandTopic });
                }
            });
        });

        // Start telemetry publishing
        setInterval(() => {
            updateRunningCycles();
            simulateRandomEvents();
            publishTelemetry(client);
        }, TELEMETRY_INTERVAL);

        log.info('Telemetry publishing started', {
            intervalSeconds: TELEMETRY_INTERVAL / 1000
        });
        log.info('Press Ctrl+C to stop');
    });

    client.on('message', (topic, message) => {
        if (topic.includes('/command')) {
            handleCommand(client, topic, message);
        }
    });

    client.on('error', (err) => {
        log.error('MQTT Error', { error: err.message });
    });

    client.on('close', () => {
        log.warn('MQTT Connection closed');
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        log.info('Shutting down simulator');
        client.end();
        process.exit(0);
    });
}

// Start the simulator
startSimulator();
