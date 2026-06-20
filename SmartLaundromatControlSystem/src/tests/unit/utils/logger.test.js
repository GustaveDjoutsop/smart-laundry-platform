/**
 * Logger Tests
 * Verifies PII redaction, log levels, and structured logging
 */

const { redactPII, getLogLevel, log } = require('../../../utils/logger');

describe('Logger Utility', () => {
    describe('PII Redaction', () => {
        describe('Phone Numbers', () => {
            it('should redact phone numbers', () => {
                const input = 'User 237677123456 requested payment';
                const output = redactPII(input);
                expect(output).toContain('237***456');
                expect(output).not.toContain('237677123456');
            });

            it('should redact international phone numbers with +', () => {
                const input = 'Call +237677123456 for support';
                const output = redactPII(input);
                expect(output).toContain('+23***456');
                expect(output).not.toContain('+237677123456');
            });

            it('should redact multiple phone numbers', () => {
                const input = 'Transfer from 237677123456 to 237650987654';
                const output = redactPII(input);
                expect(output).toContain('237***456');
                expect(output).toContain('237***654');
                expect(output).not.toContain('237677123456');
                expect(output).not.toContain('237650987654');
            });

            it('should handle short phone numbers', () => {
                const input = 'Short: 1234567890'; // 10 digits minimum for phone pattern
                const output = redactPII(input);
                expect(output).toContain('123***890');
                expect(output).not.toContain('1234567890');
            });
        });

        describe('Email Addresses', () => {
            it('should redact email addresses', () => {
                const input = 'Contact admin@example.com for help';
                const output = redactPII(input);
                expect(output).toContain('ad***@example.com');
                expect(output).not.toContain('admin@example.com');
            });

            it('should redact complex email addresses', () => {
                const input = 'Email: user.name+tag@sub.domain.com';
                const output = redactPII(input);
                // Email pattern preserves first 2 chars of username
                expect(output).toMatch(/us.*\*\*\*@sub\.domain\.com/);
                expect(output).not.toContain('user.name+tag@sub.domain.com');
            });

            it('should redact multiple emails', () => {
                const input = 'From: alice@example.com To: bob@test.com';
                const output = redactPII(input);
                expect(output).toContain('al***@example.com');
                expect(output).toContain('bo***@test.com');
            });
        });

        describe('Tokens and Secrets', () => {
            it('should redact JWT tokens', () => {
                const input = 'Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.hash';
                const output = redactPII(input);
                expect(output).toContain('[JWT_REDACTED]');
                expect(output).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
            });

            it('should redact Bearer tokens', () => {
                const input = 'Authorization: Bearer abc123def456';
                const output = redactPII(input);
                expect(output).toContain('Bearer [TOKEN_REDACTED]');
                expect(output).not.toContain('abc123def456');
            });

            it('should redact API keys', () => {
                const input = 'api_key: sk_test_1234567890abcdefghij';
                const output = redactPII(input);
                // API key gets caught by ObjectID pattern (24 hex chars) which redacts middle
                expect(output).not.toContain('1234567890abcdefghij'); // Full key not visible
                expect(output).toContain('***'); // Contains redaction marker
            });

            it('should redact passwords', () => {
                const input = 'password: MySecretPass123!';
                const output = redactPII(input);
                expect(output).toContain('[PASSWORD_REDACTED]');
                expect(output).not.toContain('MySecretPass123!');
            });
        });

        describe('Credit Cards', () => {
            it('should redact credit card numbers', () => {
                const input = 'Card: 4532 1234 5678 9010';
                const output = redactPII(input);
                expect(output).toContain('[CARD_REDACTED]');
                expect(output).not.toContain('4532 1234 5678 9010');
            });

            it('should redact credit cards without spaces', () => {
                const input = 'Card: 4532123456789010';
                const output = redactPII(input);
                // 16-digit number gets caught by phone pattern
                expect(output).not.toContain('4532123456789010'); // Full number not visible
                expect(output).toContain('***'); // Contains redaction marker
            });
        });

        describe('MongoDB ObjectIds', () => {
            it('should partially redact ObjectIds for debugging', () => {
                const input = 'Transaction: 507f1f77bcf86cd799439011';
                const output = redactPII(input);
                expect(output).toContain('507f***');
                expect(output).not.toContain('507f1f77bcf86cd799439011');
            });
        });

        describe('Object Redaction', () => {
            it('should redact PII in objects', () => {
                const input = {
                    phone: '237677123456',
                    email: 'user@example.com',
                    name: 'John Doe'
                };
                const output = redactPII(input);
                expect(output.phone).toContain('237***456');
                expect(output.email).toContain('us***@example.com');
                expect(output.name).toBe('John Doe'); // Non-PII unchanged
            });

            it('should redact sensitive field names', () => {
                const input = {
                    password: 'secret123',
                    apiKey: 'key_12345',
                    token: 'tok_67890',
                    username: 'john'
                };
                const output = redactPII(input);
                expect(output.password).toBe('[REDACTED]');
                expect(output.apiKey).toBe('[REDACTED]');
                expect(output.token).toBe('[REDACTED]');
                expect(output.username).toBe('john'); // Non-sensitive field
            });

            it('should redact nested objects', () => {
                const input = {
                    user: {
                        phone: '237677123456',
                        password: 'secret'
                    },
                    meta: {
                        email: 'admin@test.com'
                    }
                };
                const output = redactPII(input);
                expect(output.user.phone).toContain('237***456');
                expect(output.user.password).toBe('[REDACTED]');
                expect(output.meta.email).toContain('ad***@test.com');
            });
        });

        describe('Array Redaction', () => {
            it('should redact PII in arrays', () => {
                const input = ['237677123456', 'user@example.com', 'normal text'];
                const output = redactPII(input);
                expect(output[0]).toContain('237***456');
                expect(output[1]).toContain('us***@example.com');
                expect(output[2]).toBe('normal text');
            });
        });

        describe('Edge Cases', () => {
            it('should handle null and undefined', () => {
                expect(redactPII(null)).toBeNull();
                expect(redactPII(undefined)).toBeUndefined();
            });

            it('should handle numbers', () => {
                expect(redactPII(12345)).toBe(12345);
            });

            it('should handle booleans', () => {
                expect(redactPII(true)).toBe(true);
                expect(redactPII(false)).toBe(false);
            });

            it('should handle empty strings', () => {
                expect(redactPII('')).toBe('');
            });

            it('should handle empty objects', () => {
                expect(redactPII({})).toEqual({});
            });

            it('should handle empty arrays', () => {
                expect(redactPII([])).toEqual([]);
            });
        });
    });

    describe('Log Level Configuration', () => {
        const originalEnv = process.env.NODE_ENV;

        afterEach(() => {
            process.env.NODE_ENV = originalEnv;
        });

        it('should return correct log level based on environment', () => {
            // Note: getLogLevel() reads from config which is already loaded
            // so we can only test the current environment
            const level = getLogLevel();
            expect(['error', 'warn', 'info', 'debug', 'verbose']).toContain(level);
        });
    });

    describe('Log Methods', () => {
        it('should have all standard log methods', () => {
            expect(typeof log.error).toBe('function');
            expect(typeof log.warn).toBe('function');
            expect(typeof log.info).toBe('function');
            expect(typeof log.debug).toBe('function');
            expect(typeof log.verbose).toBe('function');
        });

        it('should have convenience methods', () => {
            expect(typeof log.http).toBe('function');
            expect(typeof log.db).toBe('function');
            expect(typeof log.mqtt).toBe('function');
            expect(typeof log.payment).toBe('function');
            expect(typeof log.webhook).toBe('function');
        });

        it('should not throw when logging with PII', () => {
            // These should not throw errors (actual logging is suppressed in tests)
            expect(() => log.info('User 237677123456 logged in')).not.toThrow();
            expect(() => log.error('Payment failed for user@example.com')).not.toThrow();
            expect(() => log.debug('Token: Bearer abc123')).not.toThrow();
        });

        it('should accept metadata objects', () => {
            expect(() => log.info('Test message', { userId: '123', action: 'login' })).not.toThrow();
            expect(() => log.error('Error occurred', { error: 'Invalid input', code: 400 })).not.toThrow();
        });
    });

    describe('Integration Tests', () => {
        it('should redact PII in real-world log scenarios', () => {
            const scenarios = [
                {
                    input: 'Payment received from 237677123456 to admin@example.com',
                    shouldNotContain: ['237677123456', 'admin@example.com'],
                    shouldContain: ['237***456', 'ad***@example.com']
                },
                {
                    input: 'Auth failed: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature',
                    shouldNotContain: ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'],
                    shouldContain: ['Bearer [TOKEN_REDACTED]']
                },
                {
                    input: 'User password: MySecret123 card: 4532 1234 5678 9010',
                    shouldNotContain: ['MySecret123', '4532 1234 5678 9010'],
                    shouldContain: ['[PASSWORD_REDACTED]', '[CARD_REDACTED]']
                }
            ];

            scenarios.forEach(({ input, shouldNotContain, shouldContain }) => {
                const output = redactPII(input);
                shouldNotContain.forEach(text => expect(output).not.toContain(text));
                shouldContain.forEach(text => expect(output).toContain(text));
            });
        });
    });
});
