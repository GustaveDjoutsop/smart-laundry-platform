/**
 * Embedded Machine Simulator for TEST Environment
 *
 * Runs within the server process to simulate machine telemetry
 * without requiring a separate MQTT broker or real machines.
 *
 * Enable via config: simulator.enabled = true
 */

const EventEmitter = require('events');

// Machine definitions (same as standalone simulator)
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

const STATUSES = ['IDLE', 'RUNNING', 'PAUSED', 'FINISHED', 'ERROR', 'MAINTENANCE', 'OFFLINE'];
const WASHER_CYCLES = ['none', 'quick', 'normal', 'heavy', 'delicate', 'sanitize'];
const DRYER_CYCLES = ['none', 'low_heat', 'medium_heat', 'high_heat', 'delicate', 'quick'];

const ERROR_CODES = {
    washer: [
        { code: 'OE', message: 'Drain error - Water not draining properly' },
        { code: 'UE', message: 'Unbalanced load detected' },
        { code: 'DE', message: 'Door error - Door not properly closed' },
        { code: 'FE', message: 'Water overflow error' }
    ],
    dryer: [
        { code: 'D80', message: 'Exhaust blockage 80% - Clean lint filter' },
        { code: 'D90', message: 'Exhaust blockage 90% - Service required' },
        { code: 'TE1', message: 'Thermistor error - Temperature sensor fault' }
    ]
};

class EmbeddedSimulator extends EventEmitter {
    constructor(options = {}) {
        super();
        this.telemetryInterval = options.telemetryInterval || 5000;
        this.machineStates = new Map();
        this.intervalId = null;
        this.isRunning = false;
    }

    /**
     * Initialize all machine states
     */
    initializeMachines() {
        // Initialize washers
        MACHINES.washers.forEach(washer => {
            this.machineStates.set(washer.id, {
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
            this.machineStates.set(dryer.id, {
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

        console.log(`[Simulator] Initialized ${MACHINES.washers.length} washers and ${MACHINES.dryers.length} dryers`);
    }

    /**
     * Start the simulator
     */
    start() {
        if (this.isRunning) {
            console.log('[Simulator] Already running');
            return;
        }

        console.log('[Simulator] Starting embedded machine simulator...');
        this.initializeMachines();
        this.isRunning = true;

        // Start telemetry loop
        this.intervalId = setInterval(() => {
            this.updateRunningCycles();
            this.simulateRandomEvents();
            this.publishTelemetry();
        }, this.telemetryInterval);

        console.log(`[Simulator] Publishing telemetry every ${this.telemetryInterval / 1000}s`);
    }

    /**
     * Stop the simulator
     */
    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        this.isRunning = false;
        console.log('[Simulator] Stopped');
    }

    /**
     * Get machine state by ID
     */
    getMachineState(machineId) {
        return this.machineStates.get(machineId);
    }

    /**
     * Get all machine states
     */
    getAllMachineStates() {
        return Array.from(this.machineStates.values());
    }

    /**
     * Handle command from backend (pulse, start, stop, etc.)
     */
    handleCommand(machineId, command) {
        const state = this.machineStates.get(machineId);
        if (!state) {
            console.log(`[Simulator] Unknown machine: ${machineId}`);
            return false;
        }

        console.log(`[Simulator] Command for ${machineId}:`, command);

        switch (command.action) {
            case 'pulse':
            case 'start':
                if (state.status === 'IDLE') {
                    this.startCycle(machineId, command.cycleType);
                    return true;
                }
                break;
            case 'stop':
                if (state.status === 'RUNNING') {
                    state.status = 'IDLE';
                    state.currentCycle.type = 'none';
                    this.resetTelemetry(state);
                    console.log(`[Simulator] ${machineId} stopped`);
                    return true;
                }
                break;
            case 'pause':
                if (state.status === 'RUNNING') {
                    state.status = 'PAUSED';
                    return true;
                }
                break;
            case 'resume':
                if (state.status === 'PAUSED') {
                    state.status = 'RUNNING';
                    return true;
                }
                break;
            case 'reset':
                state.status = 'IDLE';
                state.errorCode = null;
                state.errorMessage = null;
                this.resetTelemetry(state);
                return true;
            default:
                console.log(`[Simulator] Unknown command: ${command.action}`);
        }
        return false;
    }

    /**
     * Start a cycle on a machine
     */
    startCycle(machineId, cycleType = null) {
        const state = this.machineStates.get(machineId);
        if (!state || state.status !== 'IDLE') return;

        const isWasher = state.type === 'washer';
        const cycles = isWasher ? WASHER_CYCLES.filter(c => c !== 'none') : DRYER_CYCLES.filter(c => c !== 'none');
        const selectedCycle = cycleType || cycles[Math.floor(Math.random() * cycles.length)];

        const durations = {
            quick: 2,
            normal: 3,
            heavy: 4,
            delicate: 2,
            sanitize: 5,
            low_heat: 2,
            medium_heat: 3,
            high_heat: 4
        };

        const duration = durations[selectedCycle] || 3;

        state.status = 'RUNNING';
        state.currentCycle = {
            type: selectedCycle,
            startedAt: new Date(),
            duration: duration,
            remainingTime: duration,
            progress: 0
        };
        state.telemetry.doorOpen = false;
        state.maintenance.totalCycles++;
        state.maintenance.cyclesSinceService++;

        console.log(`[Simulator] ${machineId} started ${selectedCycle} cycle (${duration} min)`);
    }

    /**
     * Update running cycles
     */
    updateRunningCycles() {
        this.machineStates.forEach((state, machineId) => {
            if (state.status !== 'RUNNING') return;

            const cycle = state.currentCycle;
            const elapsed = (Date.now() - new Date(cycle.startedAt).getTime()) / 60000;
            const progress = Math.min(100, (elapsed / cycle.duration) * 100);
            const remaining = Math.max(0, cycle.duration - elapsed);

            cycle.progress = Math.round(progress);
            cycle.remainingTime = Math.round(remaining * 10) / 10;

            this.updateTelemetry(state, progress);

            if (progress >= 100) {
                state.status = 'FINISHED';
                state.currentCycle.type = 'none';
                state.currentCycle.progress = 100;
                state.currentCycle.remainingTime = 0;
                this.resetTelemetry(state);
                console.log(`[Simulator] ${machineId} finished cycle`);

                // Auto-return to IDLE
                setTimeout(() => {
                    if (this.machineStates.get(machineId)?.status === 'FINISHED') {
                        this.machineStates.get(machineId).status = 'IDLE';
                    }
                }, 30000);
            }
        });
    }

    /**
     * Simulate random events
     */
    simulateRandomEvents() {
        this.machineStates.forEach((state, machineId) => {
            if (state.status === 'ERROR' || state.status === 'MAINTENANCE') {
                if (Math.random() < 0.05) {
                    state.status = 'IDLE';
                    state.errorCode = null;
                    state.errorMessage = null;
                }
                return;
            }

            // 2% chance for IDLE machine to start
            if (state.status === 'IDLE' && Math.random() < 0.02) {
                this.startCycle(machineId);
            }

            // 1% chance for error during run
            if (state.status === 'RUNNING' && Math.random() < 0.01) {
                this.triggerError(machineId);
            }

            // Random door state for idle machines
            if (state.status === 'IDLE') {
                state.telemetry.doorOpen = Math.random() < 0.1;
            }
        });
    }

    /**
     * Update telemetry based on cycle progress
     */
    updateTelemetry(state, progress) {
        const isWasher = state.type === 'washer';

        if (isWasher) {
            if (progress < 20) {
                state.telemetry.waterLevel = Math.min(80, progress * 4);
                state.telemetry.temperature = 20 + progress;
                state.telemetry.spinSpeed = 0;
            } else if (progress < 60) {
                state.telemetry.waterLevel = 80;
                state.telemetry.temperature = 40 + Math.random() * 10;
                state.telemetry.spinSpeed = 50 + Math.random() * 30;
                state.telemetry.vibration = 2 + Math.random() * 2;
            } else if (progress < 80) {
                state.telemetry.waterLevel = 60 + Math.random() * 20;
                state.telemetry.temperature = 30 + Math.random() * 5;
                state.telemetry.spinSpeed = 100 + Math.random() * 50;
            } else {
                state.telemetry.waterLevel = Math.max(0, 80 - (progress - 80) * 4);
                state.telemetry.spinSpeed = 800 + Math.random() * 400;
                state.telemetry.vibration = 5 + Math.random() * 3;
            }
            state.telemetry.powerConsumption = 500 + Math.random() * 1500;
            state.telemetry.waterUsage = progress * 0.5;
        } else {
            const cycleType = state.currentCycle.type;
            const targetTemp = cycleType === 'high_heat' ? 70 : cycleType === 'medium_heat' ? 55 : 40;

            if (progress < 20) {
                state.telemetry.temperature = 25 + (targetTemp - 25) * (progress / 20);
                state.telemetry.humidity = 60 + Math.random() * 10;
            } else if (progress < 90) {
                state.telemetry.temperature = targetTemp + Math.random() * 5 - 2.5;
                state.telemetry.humidity = Math.max(20, 70 - progress * 0.5);
            } else {
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
    resetTelemetry(state) {
        if (state.type === 'washer') {
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
     * Trigger an error
     */
    triggerError(machineId) {
        const state = this.machineStates.get(machineId);
        if (!state) return;

        const errors = ERROR_CODES[state.type];
        const error = errors[Math.floor(Math.random() * errors.length)];

        state.status = 'ERROR';
        state.errorCode = error.code;
        state.errorMessage = error.message;
        this.resetTelemetry(state);

        console.log(`[Simulator] ${machineId} ERROR: ${error.code}`);
    }

    /**
     * Publish telemetry (emits events instead of MQTT)
     */
    publishTelemetry() {
        this.machineStates.forEach((state, machineId) => {
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

            // Emit telemetry event for internal processing
            this.emit('telemetry', machineId, telemetryData);
        });
    }
}

// Singleton instance
let simulatorInstance = null;

/**
 * Get or create the simulator instance
 */
function getSimulator(options = {}) {
    if (!simulatorInstance) {
        simulatorInstance = new EmbeddedSimulator(options);
    }
    return simulatorInstance;
}

/**
 * Start the embedded simulator if enabled in config
 */
function startIfEnabled(config) {
    if (config?.simulator?.enabled) {
        const simulator = getSimulator({
            telemetryInterval: config.simulator.telemetry_interval || 5000
        });
        simulator.start();
        return simulator;
    }
    return null;
}

module.exports = {
    EmbeddedSimulator,
    getSimulator,
    startIfEnabled
};
