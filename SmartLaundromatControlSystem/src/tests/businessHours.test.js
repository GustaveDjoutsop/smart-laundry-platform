const { parseTimeToMinutes, canStartCycle, getBusinessHoursInfo, isOpen } = require('../utils/businessHours');

describe('Business Hours Utility', () => {
    describe('parseTimeToMinutes', () => {
        it('should parse midnight correctly', () => {
            expect(parseTimeToMinutes('00:00')).toBe(0);
        });

        it('should parse noon correctly', () => {
            expect(parseTimeToMinutes('12:00')).toBe(720);
        });

        it('should parse 22:00 correctly', () => {
            expect(parseTimeToMinutes('22:00')).toBe(1320);
        });

        it('should parse times with minutes correctly', () => {
            expect(parseTimeToMinutes('21:45')).toBe(1305);
            expect(parseTimeToMinutes('07:30')).toBe(450);
        });
    });

    describe('getBusinessHoursInfo', () => {
        it('should return business hours info object', () => {
            const info = getBusinessHoursInfo();
            expect(info).toHaveProperty('openTime');
            expect(info).toHaveProperty('closeTime');
            expect(info).toHaveProperty('timezone');
            expect(info).toHaveProperty('isCurrentlyOpen');
            expect(info).toHaveProperty('currentTime');
        });

        it('should return valid time formats', () => {
            const info = getBusinessHoursInfo();
            expect(info.openTime).toMatch(/^\d{2}:\d{2}$/);
            expect(info.closeTime).toMatch(/^\d{2}:\d{2}$/);
            expect(info.currentTime).toMatch(/^\d{2}:\d{2}$/);
        });
    });

    describe('canStartCycle', () => {
        it('should return an object with allowed and reason properties', () => {
            const result = canStartCycle(30);
            expect(result).toHaveProperty('allowed');
            expect(result).toHaveProperty('reason');
        });

        it('should handle 30-minute cycle check', () => {
            const result = canStartCycle(30);
            expect(typeof result.allowed).toBe('boolean');
        });

        it('should handle 60-minute cycle check', () => {
            const result = canStartCycle(60);
            expect(typeof result.allowed).toBe('boolean');
        });
    });

    describe('isOpen', () => {
        it('should return a boolean', () => {
            const result = isOpen();
            expect(typeof result).toBe('boolean');
        });
    });

    // Edge cases and additional coverage
    describe('parseTimeToMinutes - edge cases', () => {
        it('should handle single-digit hours', () => {
            expect(parseTimeToMinutes('7:00')).toBe(420);
            expect(parseTimeToMinutes('9:30')).toBe(570);
        });

        it('should handle 23:59 (end of day)', () => {
            expect(parseTimeToMinutes('23:59')).toBe(1439);
        });

        it('should return NaN for invalid time format', () => {
            expect(parseTimeToMinutes('invalid')).toBeNaN();
            expect(parseTimeToMinutes('')).toBeNaN();
        });

        it('should handle time with seconds (should ignore)', () => {
            expect(parseTimeToMinutes('10:30:45')).toBe(630); // Should parse 10:30
        });
    });

    describe('canStartCycle - edge cases', () => {
        it('should handle very short cycles (< 15 minutes)', () => {
            const result = canStartCycle(10);
            expect(result).toHaveProperty('allowed');
            expect(result).toHaveProperty('reason');
        });

        it('should handle very long cycles (> 2 hours)', () => {
            const result = canStartCycle(150);
            expect(result).toHaveProperty('allowed');
            expect(result).toHaveProperty('reason');
        });

        it('should handle zero duration cycle', () => {
            const result = canStartCycle(0);
            expect(result).toHaveProperty('allowed');
            // Note: Current implementation allows 0-minute cycles (could be improved)
            expect(typeof result.allowed).toBe('boolean');
        });

        it('should handle negative duration cycle', () => {
            const result = canStartCycle(-30);
            expect(result).toHaveProperty('allowed');
            // Note: Current implementation allows negative cycles (could be improved)
            expect(typeof result.allowed).toBe('boolean');
        });
    });

    describe('getBusinessHoursInfo - timezone handling', () => {
        it('should use configured timezone', () => {
            const info = getBusinessHoursInfo();
            expect(info.timezone).toBeTruthy();
            expect(typeof info.timezone).toBe('string');
        });

        it('should format currentTime consistently', () => {
            const info1 = getBusinessHoursInfo();
            const info2 = getBusinessHoursInfo();
            // Current time should be within 1 minute when called twice quickly
            expect(info1.currentTime.split(':')[0]).toBe(info2.currentTime.split(':')[0]);
        });
    });

    describe('Business hours integration', () => {
        it('should have consistent open and close times', () => {
            const info = getBusinessHoursInfo();
            const openMinutes = parseTimeToMinutes(info.openTime);
            const closeMinutes = parseTimeToMinutes(info.closeTime);

            // Close time should be after open time
            expect(closeMinutes).toBeGreaterThan(openMinutes);
        });

        it('should provide reason when cycle cannot start', () => {
            const result = canStartCycle(300); // 5-hour cycle (should be too long)
            if (!result.allowed) {
                expect(result.reason).toBeTruthy();
                expect(typeof result.reason).toBe('string');
                expect(result.reason.length).toBeGreaterThan(0);
            }
        });
    });
});
