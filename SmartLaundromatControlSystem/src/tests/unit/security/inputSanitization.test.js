const mongoose = require('mongoose');
const Transaction = require('../../../models/Transaction');
const User = require('../../../models/User');

describe('Input Sanitization - NoSQL Injection Prevention', () => {
    beforeEach(async () => {
        // Clear database and create test data
        await Transaction.deleteMany({});
        await User.deleteMany({});

        // Create test transactions
        await Transaction.create([
            {
                externalReference: 'normal-ref-001',
                phoneNumber: '237650000001',
                machineId: 'washer_01',
                amount: 1000,
                cycleDuration: 30,
                pulseCount: 1,
                status: 'SUCCESSFUL',
                paymentProvider: 'campay'
            },
            {
                externalReference: 'special.chars.ref',
                phoneNumber: '237650000002',
                machineId: 'washer_02',
                amount: 2000,
                cycleDuration: 60,
                pulseCount: 2,
                status: 'SUCCESSFUL',
                paymentProvider: 'campay'
            }
        ]);

        // Create test users
        await User.create([
            {
                name: 'John Doe',
                email: 'john@example.com',
                phoneNumber: '237650000003',
                password: 'Test123!',
                role: 'employee'
            },
            {
                name: 'Jane Smith',
                email: 'jane@example.com',
                phoneNumber: '237650000004',
                password: 'Test123!',
                role: 'employee'
            }
        ]);
    }, 15000); // Increase timeout to 15 seconds for database operations

    describe('Transaction Search Sanitization', () => {
        it('should sanitize regex special characters in phone number search', async () => {
            // Test regex injection attempt with .* (matches everything)
            const maliciousSearch = '.*';
            const sanitizedSearch = maliciousSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // Direct search with malicious pattern (would match all without sanitization)
            const unsafeResults = await Transaction.find({
                phoneNumber: { $regex: maliciousSearch, $options: 'i' }
            });

            // Search with sanitized pattern (should match only literal ".*")
            const safeResults = await Transaction.find({
                phoneNumber: { $regex: sanitizedSearch, $options: 'i' }
            });

            // Without sanitization, .* matches everything
            expect(unsafeResults.length).toBeGreaterThan(0);

            // With sanitization, .* should match nothing (literal dot-star)
            expect(safeResults.length).toBe(0);
        });

        it('should sanitize regex special characters in reference search', async () => {
            const maliciousSearch = '.+';
            const sanitizedSearch = maliciousSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const unsafeResults = await Transaction.find({
                externalReference: { $regex: maliciousSearch, $options: 'i' }
            });

            const safeResults = await Transaction.find({
                externalReference: { $regex: sanitizedSearch, $options: 'i' }
            });

            // .+ matches everything
            expect(unsafeResults.length).toBeGreaterThan(0);

            // Sanitized .+ matches nothing
            expect(safeResults.length).toBe(0);
        });

        it('should allow legitimate searches to work', async () => {
            const legitimateSearch = '237650000001';
            const sanitizedSearch = legitimateSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const results = await Transaction.find({
                phoneNumber: { $regex: sanitizedSearch, $options: 'i' }
            });

            expect(results.length).toBe(1);
            expect(results[0].phoneNumber).toBe('237650000001');
        });

        it('should handle special characters in legitimate searches', async () => {
            // Search for reference with dots
            const searchWithDots = 'special.chars';
            const sanitizedSearch = searchWithDots.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const results = await Transaction.find({
                externalReference: { $regex: sanitizedSearch, $options: 'i' }
            });

            expect(results.length).toBe(1);
            expect(results[0].externalReference).toBe('special.chars.ref');
        });
    });

    describe('User Search Sanitization', () => {
        it('should sanitize regex in name search', async () => {
            const maliciousSearch = '^.*';
            const sanitizedSearch = maliciousSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const unsafeResults = await User.find({
                name: { $regex: maliciousSearch, $options: 'i' }
            });

            const safeResults = await User.find({
                name: { $regex: sanitizedSearch, $options: 'i' }
            });

            // ^.* matches everything
            expect(unsafeResults.length).toBeGreaterThan(0);

            // Sanitized version matches nothing
            expect(safeResults.length).toBe(0);
        });

        it('should sanitize regex in email search', async () => {
            const maliciousSearch = '$';
            const sanitizedSearch = maliciousSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const unsafeResults = await User.find({
                email: { $regex: maliciousSearch, $options: 'i' }
            });

            const safeResults = await User.find({
                email: { $regex: sanitizedSearch, $options: 'i' }
            });

            // $ at end matches any email
            expect(unsafeResults.length).toBeGreaterThan(0);

            // Sanitized $ is literal
            expect(safeResults.length).toBe(0);
        });

        it('should allow legitimate user searches', async () => {
            const legitimateSearch = 'john';
            const sanitizedSearch = legitimateSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const results = await User.find({
                name: { $regex: sanitizedSearch, $options: 'i' }
            });

            expect(results.length).toBe(1);
            expect(results[0].name).toContain('John');
        });
    });

    describe('Regex Injection Attack Scenarios', () => {
        it('should prevent ReDoS attack with nested quantifiers', async () => {
            // ReDoS pattern: (a+)+ can cause exponential backtracking
            const redosPattern = '(a+)+';
            const sanitizedPattern = redosPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const startTime = Date.now();
            await Transaction.find({
                phoneNumber: { $regex: sanitizedPattern, $options: 'i' }
            });
            const duration = Date.now() - startTime;

            // Should complete quickly (< 100ms) because pattern is escaped
            expect(duration).toBeLessThan(100);
        });

        it('should prevent data exfiltration via regex', async () => {
            // Attacker tries to extract data by matching patterns
            const exfiltrationAttempt = '^2376500.*';
            const sanitizedSearch = exfiltrationAttempt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const unsafeResults = await Transaction.find({
                phoneNumber: { $regex: exfiltrationAttempt, $options: 'i' }
            });

            const safeResults = await Transaction.find({
                phoneNumber: { $regex: sanitizedSearch, $options: 'i' }
            });

            // Without sanitization, could match phone numbers
            expect(unsafeResults.length).toBeGreaterThan(0);

            // With sanitization, matches nothing
            expect(safeResults.length).toBe(0);
        });

        it('should handle all regex special characters', () => {
            const allSpecialChars = '.?*+^${}()[]\\|';
            const sanitized = allSpecialChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            // All special chars should be escaped
            expect(sanitized).toBe('\\.\\?\\*\\+\\^\\$\\{\\}\\(\\)\\[\\]\\\\\\|');
        });

        it('should prevent alternation injection', async () => {
            // Attacker tries to use | for alternation
            const alternationAttempt = 'normal|.*';
            const sanitizedSearch = alternationAttempt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const safeResults = await Transaction.find({
                externalReference: { $regex: sanitizedSearch, $options: 'i' }
            });

            // Should match literal "normal|.*", not "normal" OR "anything"
            expect(safeResults.length).toBe(0);
        });

        it('should prevent character class injection', async () => {
            // Attacker tries to use [0-9] to match any digit
            const charClassAttempt = '[0-9]{10}';
            const sanitizedSearch = charClassAttempt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const safeResults = await Transaction.find({
                phoneNumber: { $regex: sanitizedSearch, $options: 'i' }
            });

            // Should match literal string "[0-9]{10}", not any 10 digits
            expect(safeResults.length).toBe(0);
        });
    });

    describe('Case Sensitivity', () => {
        it('should maintain case-insensitive search after sanitization', async () => {
            const search = 'NORMAL';
            const sanitizedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

            const results = await Transaction.find({
                externalReference: { $regex: sanitizedSearch, $options: 'i' }
            });

            expect(results.length).toBe(1);
            expect(results[0].externalReference).toContain('normal');
        });
    });
});
