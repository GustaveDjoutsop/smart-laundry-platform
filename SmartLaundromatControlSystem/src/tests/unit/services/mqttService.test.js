/**
 * MQTT Service Tests
 * Verifies MQTT validation functions and logging
 */

const { _validateMachineId, _validatePulseCount, _validateAction } = require('../../../services/mqttService');
const config = require('../../../config/env');

describe('MQTT Service', () => {
    describe('Machine ID Validation', () => {
        const originalMachines = config.MACHINES.AVAILABLE_MACHINES;

        afterAll(() => {
            // Restore original config
            config.MACHINES.AVAILABLE_MACHINES = originalMachines;
        });

        it('should accept valid machine IDs from whitelist', () => {
            config.MACHINES.AVAILABLE_MACHINES = ['washer_01', 'washer_02', 'dryer_01'];
            expect(_validateMachineId('washer_01')).toBe(true);
            expect(_validateMachineId('washer_02')).toBe(true);
            expect(_validateMachineId('dryer_01')).toBe(true);
        });

        it('should reject machine IDs not in whitelist', () => {
            config.MACHINES.AVAILABLE_MACHINES = ['washer_01', 'washer_02'];
            expect(_validateMachineId('washer_03')).toBe(false);
            expect(_validateMachineId('dryer_01')).toBe(false);
            expect(_validateMachineId('unknown_machine')).toBe(false);
        });

        it('should reject null or undefined machine IDs', () => {
            expect(_validateMachineId(null)).toBe(false);
            expect(_validateMachineId(undefined)).toBe(false);
            expect(_validateMachineId('')).toBe(false);
        });

        it('should reject non-string machine IDs', () => {
            expect(_validateMachineId(123)).toBe(false);
            expect(_validateMachineId({ id: 'washer_01' })).toBe(false);
            expect(_validateMachineId(['washer_01'])).toBe(false);
        });

        it('should allow all machine IDs if whitelist is empty (development mode)', () => {
            config.MACHINES.AVAILABLE_MACHINES = [];
            expect(_validateMachineId('any_machine')).toBe(true);
            expect(_validateMachineId('test_device')).toBe(true);
        });
    });

    describe('Pulse Count Validation', () => {
        it('should accept valid pulse counts (1-10)', () => {
            expect(_validatePulseCount(1)).toBe(true);
            expect(_validatePulseCount(5)).toBe(true);
            expect(_validatePulseCount(10)).toBe(true);
        });

        it('should accept pulse counts as strings', () => {
            expect(_validatePulseCount('1')).toBe(true);
            expect(_validatePulseCount('5')).toBe(true);
            expect(_validatePulseCount('10')).toBe(true);
        });

        it('should reject pulse counts below 1', () => {
            expect(_validatePulseCount(0)).toBe(false);
            expect(_validatePulseCount(-1)).toBe(false);
            expect(_validatePulseCount(-10)).toBe(false);
        });

        it('should reject pulse counts above 10', () => {
            expect(_validatePulseCount(11)).toBe(false);
            expect(_validatePulseCount(20)).toBe(false);
            expect(_validatePulseCount(100)).toBe(false);
        });

        it('should reject non-numeric pulse counts', () => {
            expect(_validatePulseCount('abc')).toBe(false);
            expect(_validatePulseCount(null)).toBe(false);
            expect(_validatePulseCount(undefined)).toBe(false);
            expect(_validatePulseCount(NaN)).toBe(false);
        });

        it('should reject decimal pulse counts', () => {
            expect(_validatePulseCount(1.5)).toBe(false);
            expect(_validatePulseCount(5.9)).toBe(false);
        });
    });

    describe('Action Validation', () => {
        it('should accept valid actions', () => {
            expect(_validateAction('pulse')).toBe(true);
            expect(_validateAction('status')).toBe(true);
            expect(_validateAction('stop')).toBe(true);
            expect(_validateAction('reset')).toBe(true);
        });

        it('should reject invalid actions', () => {
            expect(_validateAction('start')).toBe(false);
            expect(_validateAction('delete')).toBe(false);
            expect(_validateAction('update')).toBe(false);
            expect(_validateAction('unknown')).toBe(false);
        });

        it('should reject empty or null actions', () => {
            expect(_validateAction('')).toBe(false);
            expect(_validateAction(null)).toBe(false);
            expect(_validateAction(undefined)).toBe(false);
        });

        it('should be case-sensitive', () => {
            expect(_validateAction('PULSE')).toBe(false);
            expect(_validateAction('Pulse')).toBe(false);
            expect(_validateAction('STATUS')).toBe(false);
        });

        it('should reject non-string actions', () => {
            expect(_validateAction(123)).toBe(false);
            expect(_validateAction({ action: 'pulse' })).toBe(false);
            expect(_validateAction(['pulse'])).toBe(false);
        });
    });

    describe('Security - Command Injection Prevention', () => {
        it('should reject machine IDs with special characters', () => {
            config.MACHINES.AVAILABLE_MACHINES = ['washer_01'];
            expect(_validateMachineId('washer_01; rm -rf /')).toBe(false);
            expect(_validateMachineId('../../../etc/passwd')).toBe(false);
            expect(_validateMachineId('washer_01 && echo pwned')).toBe(false);
        });

        it('should reject actions with injection attempts', () => {
            expect(_validateAction('pulse; cat /etc/passwd')).toBe(false);
            expect(_validateAction('stop && whoami')).toBe(false);
            expect(_validateAction('reset | nc')).toBe(false);
        });

        it('should reject pulse counts with injection attempts', () => {
            expect(_validatePulseCount('5; rm -rf /')).toBe(false);
            expect(_validatePulseCount('1 && cat /etc/passwd')).toBe(false);
        });
    });

    describe('Integration - Validation Together', () => {
        beforeAll(() => {
            config.MACHINES.AVAILABLE_MACHINES = ['washer_01', 'washer_02', 'dryer_01'];
        });

        it('should validate a complete valid command', () => {
            const machineId = 'washer_01';
            const action = 'pulse';
            const pulses = 5;

            expect(_validateMachineId(machineId)).toBe(true);
            expect(_validateAction(action)).toBe(true);
            expect(_validatePulseCount(pulses)).toBe(true);
        });

        it('should detect invalid machine ID in complete command', () => {
            const machineId = 'washer_99';
            const action = 'pulse';
            const pulses = 5;

            expect(_validateMachineId(machineId)).toBe(false);
            expect(_validateAction(action)).toBe(true);
            expect(_validatePulseCount(pulses)).toBe(true);
        });

        it('should detect invalid action in complete command', () => {
            const machineId = 'washer_01';
            const action = 'hack';
            const pulses = 5;

            expect(_validateMachineId(machineId)).toBe(true);
            expect(_validateAction(action)).toBe(false);
            expect(_validatePulseCount(pulses)).toBe(true);
        });

        it('should detect invalid pulse count in complete command', () => {
            const machineId = 'washer_01';
            const action = 'pulse';
            const pulses = 100;

            expect(_validateMachineId(machineId)).toBe(true);
            expect(_validateAction(action)).toBe(true);
            expect(_validatePulseCount(pulses)).toBe(false);
        });
    });
});
