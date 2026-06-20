const { closeRedis } = require('../../../utils/stateManager');

describe('State Manager (Redis/In-Memory Session Storage)', () => {
    let getSession;
    let setSession;
    let clearSession;
    let _isUsingRedis;

    beforeEach(() => {
        // Require fresh instance for each test
        jest.resetModules();
        const stateManager = require('../../../utils/stateManager');
        getSession = stateManager.getSession;
        setSession = stateManager.setSession;
        clearSession = stateManager.clearSession;
        _isUsingRedis = stateManager._isUsingRedis;
    });

    afterAll(async () => {
        // Clean up Redis connection and timers
        await closeRedis();
    });

    describe('In-Memory Storage Mode', () => {
        const originalRedisUrl = process.env.REDIS_URL;

        beforeEach(() => {
            // Ensure REDIS_URL is not set for in-memory tests
            delete process.env.REDIS_URL;
        });

        afterEach(() => {
            // Restore original REDIS_URL
            process.env.REDIS_URL = originalRedisUrl;
        });

        it('should use in-memory storage when REDIS_URL is not set', () => {
            expect(_isUsingRedis()).toBe(false);
        });

        it('should get default session for new phone number', async () => {
            const session = await getSession('237677000000');
            expect(session).toEqual({ step: 'MAIN_MENU' });
        });

        it('should set and retrieve session data', async () => {
            const phone = '237677111111';
            await setSession(phone, { step: 'SELECT_MACHINE', machineId: 'washer_01' });

            const session = await getSession(phone);
            expect(session).toEqual({
                step: 'SELECT_MACHINE',
                machineId: 'washer_01'
            });
        });

        it('should merge session data on multiple sets', async () => {
            const phone = '237677222222';
            await setSession(phone, { step: 'SELECT_MACHINE' });
            await setSession(phone, { machineId: 'washer_01' });
            await setSession(phone, { lang: 'en' });

            const session = await getSession(phone);
            expect(session).toEqual({
                step: 'SELECT_MACHINE',
                machineId: 'washer_01',
                lang: 'en'
            });
        });

        it('should clear session data', async () => {
            const phone = '237677333333';
            await setSession(phone, { step: 'PAYMENT' });
            await clearSession(phone);

            const session = await getSession(phone);
            expect(session).toEqual({ step: 'MAIN_MENU' });
        });

        it('should handle multiple concurrent sessions', async () => {
            const phone1 = '237677444444';
            const phone2 = '237677555555';

            await setSession(phone1, { step: 'SELECT_MACHINE', lang: 'en' });
            await setSession(phone2, { step: 'SELECT_CYCLE', lang: 'fr' });

            const session1 = await getSession(phone1);
            const session2 = await getSession(phone2);

            expect(session1).toEqual({ step: 'SELECT_MACHINE', lang: 'en' });
            expect(session2).toEqual({ step: 'SELECT_CYCLE', lang: 'fr' });
        });
    });

    describe('Error Handling', () => {
        it('should throw error when phone number is missing in getSession', async () => {
            await expect(getSession(null)).rejects.toThrow('Phone number is required');
            await expect(getSession('')).rejects.toThrow('Phone number is required');
        });

        it('should throw error when phone number is missing in setSession', async () => {
            await expect(setSession(null, { step: 'MAIN_MENU' })).rejects.toThrow('Phone number is required');
            await expect(setSession('', { step: 'MAIN_MENU' })).rejects.toThrow('Phone number is required');
        });

        it('should throw error when phone number is missing in clearSession', async () => {
            await expect(clearSession(null)).rejects.toThrow('Phone number is required');
            await expect(clearSession('')).rejects.toThrow('Phone number is required');
        });

        it('should handle gracefully when clearing non-existent session', async () => {
            // Should not throw error
            await clearSession('237699999999');

            // Verify it's still empty
            const session = await getSession('237699999999');
            expect(session).toEqual({ step: 'MAIN_MENU' });
        });
    });

    describe('Session Data Integrity', () => {
        it('should preserve language preference across step changes', async () => {
            const phone = '237677666666';
            await setSession(phone, { step: 'MAIN_MENU', lang: 'fr' });
            await setSession(phone, { step: 'SELECT_MACHINE' });

            const session = await getSession(phone);
            expect(session.step).toBe('SELECT_MACHINE');
            expect(session.lang).toBe('fr');
        });

        it('should allow updating existing fields', async () => {
            const phone = '237677777777';
            await setSession(phone, { step: 'SELECT_MACHINE', machineId: 'washer_01' });
            await setSession(phone, { machineId: 'washer_02' });

            const session = await getSession(phone);
            expect(session.step).toBe('SELECT_MACHINE');
            expect(session.machineId).toBe('washer_02');
        });

        it('should handle special characters in session data', async () => {
            const phone = '237677888888';
            await setSession(phone, {
                step: 'SELECT_MACHINE',
                machineName: 'Washer #1 (Heavy-Duty)',
                note: 'Special chars: é, ñ, ç, ü'
            });

            const session = await getSession(phone);
            expect(session.machineName).toBe('Washer #1 (Heavy-Duty)');
            expect(session.note).toBe('Special chars: é, ñ, ç, ü');
        });
    });

    describe('WhatsApp Conversation Flow Simulation', () => {
        it('should simulate complete wash cycle conversation', async () => {
            const phone = '237677999999';

            // 1. User starts conversation - main menu
            const step1 = await getSession(phone);
            expect(step1.step).toBe('MAIN_MENU');

            // 2. User selects language
            await setSession(phone, { step: 'MAIN_MENU', lang: 'en' });

            // 3. User selects "Start a Wash"
            await setSession(phone, { step: 'SELECT_MACHINE' });

            // 4. User scans QR code - machine selected
            await setSession(phone, { machineId: 'washer_01' });

            // 5. User enters SELECT_CYCLE step
            await setSession(phone, { step: 'SELECT_CYCLE' });

            const step5 = await getSession(phone);
            expect(step5).toEqual({
                step: 'SELECT_CYCLE',
                lang: 'en',
                machineId: 'washer_01'
            });

            // 6. Payment confirmed - clear session
            await clearSession(phone);

            const stepFinal = await getSession(phone);
            expect(stepFinal.step).toBe('MAIN_MENU');
        });

        it('should handle user canceling mid-conversation', async () => {
            const phone = '237650000000';
            await setSession(phone, { step: 'SELECT_CYCLE', lang: 'en', machineId: 'washer_01' });

            // User types "cancel" - reset to main menu but preserve language
            await setSession(phone, { step: 'MAIN_MENU' });

            const session = await getSession(phone);
            expect(session.step).toBe('MAIN_MENU');
            expect(session.lang).toBe('en');
        });
    });
});
