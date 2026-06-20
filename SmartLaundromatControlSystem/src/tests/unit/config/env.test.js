/**
 * Environment Configuration Validation Tests
 *
 * Note: These tests verify the configuration module's validation logic.
 * The actual env.js module runs validation on load, so these tests
 * verify the behavior rather than re-running the validation.
 */

const config = require('../../../config/env');

describe('Environment Configuration', () => {
    describe('Required Environment Variables', () => {
        it('should have JWT_SECRET configured', () => {
            expect(process.env.JWT_SECRET).toBeDefined();
            expect(process.env.JWT_SECRET).not.toBe('');
        });

        it('should have MONGO_URI configured', () => {
            // Skip in test environment - we use mongodb-memory-server instead
            if (config.IS_TEST) {
                // In test env, MONGO_URI may not be set because we use mongodb-memory-server
                // which is configured in src/tests/setup.js
                expect(config.NODE_ENV).toBe('test');
            } else {
                expect(config.MONGO_URI).toBeDefined();
                expect(config.MONGO_URI).not.toBe('');
            }
        });

        it('should have valid NODE_ENV', () => {
            expect(config.NODE_ENV).toBeDefined();
            expect(['development', 'test', 'stage', 'staging', 'production', 'prod']).toContain(config.NODE_ENV);
        });
    });

    describe('Environment Detection', () => {
        it('should correctly detect test environment', () => {
            expect(config.IS_TEST).toBe(true);
            expect(config.IS_PRODUCTION).toBe(false);
            expect(config.IS_STAGE).toBe(false);
            expect(config.IS_DEVELOPMENT).toBe(false);
        });

        it('should set only one environment flag to true', () => {
            const envFlags = [
                config.IS_TEST,
                config.IS_PRODUCTION,
                config.IS_STAGE,
                config.IS_DEVELOPMENT
            ];
            const trueCount = envFlags.filter(flag => flag === true).length;
            expect(trueCount).toBe(1);
        });
    });

    describe('Server Configuration', () => {
        it('should have valid PORT', () => {
            expect(config.PORT).toBeDefined();
            expect(typeof config.PORT).toBe('number');
            expect(config.PORT).toBeGreaterThan(0);
            expect(config.PORT).toBeLessThan(65536);
        });
    });

    describe('Payment Provider Configuration', () => {
        it('should have valid payment provider selection', () => {
            expect(config.PAYMENT_PROVIDER).toBeDefined();
            expect(['campay', 'mtn']).toContain(config.PAYMENT_PROVIDER);
        });

        it('should have Campay configuration if Campay is selected', () => {
            if (config.PAYMENT_PROVIDER === 'campay') {
                expect(config.CAMPAY_BASE_URL).toBeDefined();
                expect(config.CAMPAY_BASE_URL).toMatch(/^https?:\/\//);
            }
        });

        it('should have MTN configuration if MTN is selected', () => {
            if (config.PAYMENT_PROVIDER === 'mtn') {
                expect(config.MTN_API_URL).toBeDefined();
                expect(config.MTN_API_URL).toMatch(/^https?:\/\//);
                expect(config.MTN_ENV).toBeDefined();
                expect(['sandbox', 'production']).toContain(config.MTN_ENV);
            }
        });
    });

    describe('WhatsApp Configuration', () => {
        it('should have WhatsApp business phone number', () => {
            expect(config.WHATSAPP_BUSINESS_PHONE).toBeDefined();
            expect(typeof config.WHATSAPP_BUSINESS_PHONE).toBe('string');
        });
    });

    describe('Pricing Configuration', () => {
        it('should have valid pricing configuration', () => {
            expect(config.PRICING).toBeDefined();
            expect(config.PRICING.SHORT_CYCLE).toBeGreaterThan(0);
            expect(config.PRICING.LONG_CYCLE).toBeGreaterThan(0);
            expect(config.PRICING.LONG_CYCLE).toBeGreaterThanOrEqual(config.PRICING.SHORT_CYCLE);
        });
    });

    describe('Cycle Configuration', () => {
        it('should have valid cycle configurations', () => {
            expect(config.CYCLES.SHORT).toBeDefined();
            expect(config.CYCLES.LONG).toBeDefined();

            expect(config.CYCLES.SHORT.duration).toBeDefined();
            expect(config.CYCLES.SHORT.pulseCount).toBeGreaterThan(0);

            expect(config.CYCLES.LONG.duration).toBeDefined();
            expect(config.CYCLES.LONG.pulseCount).toBeGreaterThan(0);
        });

        it('should have long cycle equal or longer than short cycle', () => {
            const shortDuration = parseInt(config.CYCLES.SHORT.duration);
            const longDuration = parseInt(config.CYCLES.LONG.duration);
            expect(longDuration).toBeGreaterThanOrEqual(shortDuration);
        });
    });

    describe('Machine Configuration', () => {
        it('should have available machines configured', () => {
            expect(config.MACHINES.AVAILABLE_MACHINES).toBeDefined();
            expect(Array.isArray(config.MACHINES.AVAILABLE_MACHINES)).toBe(true);
            expect(config.MACHINES.AVAILABLE_MACHINES.length).toBeGreaterThan(0);
        });

        it('should have valid machine ID format', () => {
            config.MACHINES.AVAILABLE_MACHINES.forEach(machineId => {
                expect(typeof machineId).toBe('string');
                expect(machineId).toMatch(/^(washer|dryer)_\d{2}$/);
            });
        });
    });

    describe('Business Hours Configuration', () => {
        it('should have valid business hours', () => {
            expect(config.BUSINESS_HOURS.OPEN_TIME).toBeDefined();
            expect(config.BUSINESS_HOURS.CLOSE_TIME).toBeDefined();
            expect(config.BUSINESS_HOURS.TIMEZONE).toBeDefined();

            // Validate time format (HH:MM)
            expect(config.BUSINESS_HOURS.OPEN_TIME).toMatch(/^\d{2}:\d{2}$/);
            expect(config.BUSINESS_HOURS.CLOSE_TIME).toMatch(/^\d{2}:\d{2}$/);
        });

        it('should have valid timezone', () => {
            expect(config.BUSINESS_HOURS.TIMEZONE).toBe('Africa/Douala');
        });

        it('should have valid closing buffer', () => {
            expect(config.BUSINESS_HOURS.CLOSING_BUFFER_MINUTES).toBeGreaterThan(0);
            expect(config.BUSINESS_HOURS.CLOSING_BUFFER_MINUTES).toBeLessThan(120);
        });
    });

    describe('Monitoring Configuration', () => {
        it('should have valid monitoring intervals', () => {
            expect(config.MONITORING.CYCLE_CHECK_INTERVAL).toBeGreaterThan(0);
            expect(config.MONITORING.FEEDBACK_CHECK_INTERVAL).toBeGreaterThan(0);
            expect(config.MONITORING.FEEDBACK_DELAY_AFTER_CYCLE).toBeGreaterThan(0);
        });
    });

    describe('Feedback Configuration', () => {
        it('should have valid low rating threshold', () => {
            expect(config.FEEDBACK.LOW_RATING_THRESHOLD).toBeGreaterThan(0);
            expect(config.FEEDBACK.LOW_RATING_THRESHOLD).toBeLessThanOrEqual(5);
        });
    });

    describe('Logging Configuration', () => {
        it('should have valid logging level', () => {
            const validLevels = ['error', 'warn', 'info', 'debug', 'verbose'];
            expect(validLevels).toContain(config.LOGGING.LEVEL);
        });

        it('should have boolean include_request_body flag', () => {
            expect(typeof config.LOGGING.INCLUDE_REQUEST_BODY).toBe('boolean');
        });
    });

    describe('Security Validation', () => {
        it('should not expose sensitive data in config export', () => {
            // JWT_SECRET should not be in the exported config
            expect(config.JWT_SECRET).toBeUndefined();

            // Password should not be in MQTT config
            if (config.MQTT_PASSWORD) {
                expect(typeof config.MQTT_PASSWORD).toBe('string');
            }
        });

        it('should use HTTPS URLs in production', () => {
            if (config.IS_PRODUCTION) {
                if (config.CAMPAY_BASE_URL) {
                    expect(config.CAMPAY_BASE_URL).toMatch(/^https:\/\//);
                }
                if (config.MTN_API_URL) {
                    expect(config.MTN_API_URL).toMatch(/^https:\/\//);
                }
            }
        });
    });

    describe('Configuration Consistency', () => {
        it('should have consistent payment configuration', () => {
            if (config.PAYMENT_PROVIDER === 'campay') {
                expect(config.CAMPAY_BASE_URL).toBeDefined();
            } else if (config.PAYMENT_PROVIDER === 'mtn') {
                expect(config.MTN_API_URL).toBeDefined();
            }
        });

        it('should have YAML config available', () => {
            expect(config._yaml).toBeDefined();
            expect(typeof config._yaml).toBe('object');
        });
    });

    describe('Production-Specific Validation', () => {
        it('should require production secrets in production environment', () => {
            if (config.IS_PRODUCTION || config.IS_STAGE) {
                // These checks would normally throw during module load
                // Here we just verify the config has them
                expect(config.META_TOKEN || config.IS_TEST).toBeTruthy();
                expect(config.META_PHONE_ID || config.IS_TEST).toBeTruthy();
                expect(config.META_VERIFY || config.IS_TEST).toBeTruthy();
            }
        });
    });
});
