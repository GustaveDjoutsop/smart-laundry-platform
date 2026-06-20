const { t, isSupported, getSupportedLanguages, DEFAULT_LANGUAGE } = require('../utils/i18n');

describe('i18n Helper', () => {
    it('should return English translation by default', () => {
        const result = t('welcome');
        expect(result).toContain('Welcome to Smart Laundry');
    });

    it('should return French translation when lang is fr', () => {
        const result = t('welcome', 'fr');
        expect(result).toContain('Bienvenue chez Smart Laundry');
    });

    it('should interpolate parameters correctly', () => {
        const result = t('machines_available', 'en', { count: 5 });
        expect(result).toContain('5 machine(s) available');
    });

    it('should interpolate parameters in French', () => {
        const result = t('machines_available', 'fr', { count: 3 });
        expect(result).toContain('3 machine(s) disponible(s)');
    });

    it('should fall back to English for unsupported language', () => {
        const result = t('welcome', 'de');
        expect(result).toContain('Welcome to Smart Laundry');
    });

    it('should return key if translation not found', () => {
        const result = t('nonexistent_key');
        expect(result).toBe('nonexistent_key');
    });

    it('should report supported languages correctly', () => {
        expect(isSupported('en')).toBe(true);
        expect(isSupported('fr')).toBe(true);
        expect(isSupported('de')).toBe(false);
    });

    it('should return all supported languages', () => {
        const languages = getSupportedLanguages();
        expect(languages).toContain('en');
        expect(languages).toContain('fr');
        expect(languages.length).toBe(2);
    });

    it('should have English as default language', () => {
        expect(DEFAULT_LANGUAGE).toBe('en');
    });

    // Payment failure reason translations
    it('should have failure reason translations in English', () => {
        expect(t('failure_reason_cancelled', 'en')).toContain('cancelled');
        expect(t('failure_reason_timeout', 'en')).toContain('timed out');
        expect(t('failure_reason_insufficient_funds', 'en')).toContain('Insufficient');
        expect(t('failure_reason_declined', 'en')).toContain('declined');
        expect(t('failure_reason_unknown', 'en')).toContain('Unknown');
    });

    it('should have failure reason translations in French', () => {
        expect(t('failure_reason_cancelled', 'fr')).toContain('annulé');
        expect(t('failure_reason_timeout', 'fr')).toContain('expiré');
        expect(t('failure_reason_insufficient_funds', 'fr')).toContain('insuffisant');
        expect(t('failure_reason_declined', 'fr')).toContain('refusé');
        expect(t('failure_reason_unknown', 'fr')).toContain('inconnue');
    });

    it('should include reason placeholder in payment failed notification', () => {
        const enResult = t('payment_failed_notification', 'en', { machine: 'Washer 01', reason: 'Test reason' });
        expect(enResult).toContain('Test reason');
        expect(enResult).toContain('Reason:');

        const frResult = t('payment_failed_notification', 'fr', { machine: 'Washer 01', reason: 'Raison de test' });
        expect(frResult).toContain('Raison de test');
        expect(frResult).toContain('Raison:');
    });

    // Edge cases and additional coverage
    it('should handle null or undefined language gracefully', () => {
        expect(t('welcome', null)).toContain('Welcome');
        expect(t('welcome', undefined)).toContain('Welcome');
    });

    it('should handle missing parameters in interpolation', () => {
        const result = t('machines_available', 'en', {});
        expect(result).toBeTruthy(); // Should not crash
    });

    it('should handle extra parameters in interpolation', () => {
        const result = t('welcome', 'en', { unused: 'value', extra: 123 });
        expect(result).toContain('Welcome');
    });

    it('should handle empty string as key', () => {
        const result = t('', 'en');
        expect(result).toBe('');
    });

    it('should handle case-sensitive language codes', () => {
        expect(t('welcome', 'EN')).toContain('Welcome'); // Fallback to English for 'EN'
        expect(t('welcome', 'fr')).toContain('Bienvenue'); // Lowercase 'fr' works correctly
        // Note: Current implementation is case-sensitive (could normalize with toLowerCase())
    });

    it('should have consistent translations across both languages', () => {
        // Verify key translation keys exist in both languages
        const keysToCheck = ['welcome', 'machines_available', 'payment_failed_notification'];
        keysToCheck.forEach(key => {
            expect(t(key, 'en')).not.toBe(key);
            expect(t(key, 'fr')).not.toBe(key);
        });
    });
});
