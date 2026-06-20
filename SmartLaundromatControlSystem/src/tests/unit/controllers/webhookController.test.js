const request = require('supertest');
const crypto = require('crypto');
const express = require('express');
const bodyParser = require('body-parser');
const mongoose = require('mongoose');
const Transaction = require('../../../models/Transaction');
const webhookController = require('../../../controllers/webhookController');
const config = require('../../../config/env');
const { closeRedis } = require('../../../utils/stateManager');

// Create test Express app
const app = express();
app.use(bodyParser.json());
app.post('/webhook/campay', webhookController.handleCampay);
app.post('/webhook/mtn', webhookController.handleMtn);
app.post('/webhook/whatsapp', webhookController.handleWhatsApp);

describe('WebhookController - Signature Validation', () => {
    beforeEach(async () => {
        // Clear database
        await Transaction.deleteMany({});
    });

    afterAll(async () => {
        // Clean up Redis connection and timers
        await closeRedis();
    });

    describe('Campay Webhook Signature Validation', () => {
        it('should reject webhook without signature', async () => {
            const payload = {
                reference: 'CAMP123',
                external_reference: 'test-uuid-123',
                status: 'SUCCESSFUL'
            };

            const res = await request(app)
                .post('/webhook/campay')
                .send(payload);

            // Should reject if signature is missing and CAMPAY_WEBHOOK_SECRET is set
            if (config.CAMPAY_WEBHOOK_SECRET) {
                expect(res.statusCode).toBe(401);
                expect(res.body.error).toBe('Invalid signature');
            }
        });

        it('should reject webhook with invalid signature', async () => {
            if (!config.CAMPAY_WEBHOOK_SECRET) {
                console.log('⚠️  Skipping test - CAMPAY_WEBHOOK_SECRET not configured');
                return;
            }

            const payload = {
                reference: 'CAMP123',
                external_reference: 'test-uuid-123',
                status: 'SUCCESSFUL'
            };

            const res = await request(app)
                .post('/webhook/campay')
                .set('x-campay-signature', 'invalid-signature-123')
                .send(payload);

            expect(res.statusCode).toBe(401);
            expect(res.body.error).toBe('Invalid signature');
        });

        it('should accept webhook with valid signature', async () => {
            if (!config.CAMPAY_WEBHOOK_SECRET) {
                console.log('⚠️  Skipping test - CAMPAY_WEBHOOK_SECRET not configured');
                return;
            }

            // Create a test transaction first
            const transaction = await Transaction.create({
                externalReference: 'test-uuid-456',
                phoneNumber: '237650000001',
                machineId: 'washer_01',
                amount: 1000,
                cycleDuration: 30,
                pulseCount: 1,
                status: 'PENDING',
                paymentProvider: 'campay'
            });

            const payload = {
                reference: 'CAMP456',
                external_reference: transaction.externalReference,
                status: 'SUCCESSFUL',
                amount: 1000
            };

            // Generate valid signature
            const validSignature = crypto
                .createHmac('sha256', config.CAMPAY_WEBHOOK_SECRET)
                .update(JSON.stringify(payload))
                .digest('hex');

            const res = await request(app)
                .post('/webhook/campay')
                .set('x-campay-signature', validSignature)
                .send(payload);

            expect(res.statusCode).toBe(200);
        });
    });

    describe('WhatsApp Webhook Signature Validation', () => {
        it('should accept webhook with valid Meta signature', async () => {
            if (!config.META_APP_SECRET) {
                console.log('⚠️  Skipping test - META_APP_SECRET not configured');
                return;
            }

            const payload = {
                entry: [{
                    changes: [{
                        value: {
                            messages: [{
                                from: '237650000001',
                                type: 'text',
                                text: { body: 'Hello' }
                            }]
                        }
                    }]
                }]
            };

            // Generate valid Meta signature (sha256=<hash>)
            // NOTE: Meta uses APP_SECRET (not access token) for webhook signature validation
            const validSignature = 'sha256=' + crypto
                .createHmac('sha256', config.META_APP_SECRET)
                .update(JSON.stringify(payload))
                .digest('hex');

            const res = await request(app)
                .post('/webhook/whatsapp')
                .set('x-hub-signature-256', validSignature)
                .send(payload);

            expect(res.statusCode).toBe(200);
        });

        it('should reject webhook with invalid Meta signature', async () => {
            if (!config.META_APP_SECRET) {
                console.log('⚠️  Skipping test - META_APP_SECRET not configured');
                return;
            }

            const payload = {
                entry: [{
                    changes: [{
                        value: {
                            messages: [{
                                from: '237650000001',
                                type: 'text',
                                text: { body: 'Hello' }
                            }]
                        }
                    }]
                }]
            };

            const res = await request(app)
                .post('/webhook/whatsapp')
                .set('x-hub-signature-256', 'sha256=invalid-signature')
                .send(payload);

            expect(res.statusCode).toBe(401);
            expect(res.body.error).toBe('Invalid signature');
        });

        it('should reject webhook without signature when META_APP_SECRET is configured', async () => {
            if (!config.META_APP_SECRET) {
                console.log('⚠️  Skipping test - META_APP_SECRET not configured');
                return;
            }

            const payload = {
                entry: [{
                    changes: [{
                        value: {
                            messages: [{
                                from: '237650000001',
                                type: 'text',
                                text: { body: 'Hello' }
                            }]
                        }
                    }]
                }]
            };

            // Send request WITHOUT x-hub-signature-256 header
            const res = await request(app)
                .post('/webhook/whatsapp')
                .send(payload);

            expect(res.statusCode).toBe(401);
            expect(res.body.error).toBe('Invalid signature');
        });
    });

    describe('MTN Webhook Signature Validation', () => {
        it('should allow MTN webhook in sandbox mode', async () => {
            // Create a test transaction first
            const transaction = await Transaction.create({
                externalReference: 'mtn-test-uuid-789',
                phoneNumber: '237650000002',
                machineId: 'dryer_01',
                amount: 2000,
                cycleDuration: 60,
                pulseCount: 2,
                status: 'PENDING',
                paymentProvider: 'mtn'
            });

            const payload = {
                externalId: transaction.externalReference,
                status: 'SUCCESSFUL',
                financialTransactionId: 'MTN123456'
            };

            const res = await request(app)
                .post('/webhook/mtn')
                .send(payload);

            // Should allow in sandbox mode
            if (config.MTN_ENV === 'sandbox') {
                expect(res.statusCode).toBe(200);
            }
        });
    });

    describe('Signature Validation Edge Cases', () => {
        it('should handle timing attack prevention', async () => {
            if (!config.CAMPAY_WEBHOOK_SECRET) {
                console.log('⚠️  Skipping test - CAMPAY_WEBHOOK_SECRET not configured');
                return;
            }

            const payload = {
                reference: 'CAMP999',
                external_reference: 'test-uuid-999',
                status: 'SUCCESSFUL'
            };

            // Generate two different invalid signatures
            const invalidSig1 = 'a'.repeat(64);
            const invalidSig2 = 'b'.repeat(64);

            const start1 = Date.now();
            await request(app)
                .post('/webhook/campay')
                .set('x-campay-signature', invalidSig1)
                .send(payload);
            const time1 = Date.now() - start1;

            const start2 = Date.now();
            await request(app)
                .post('/webhook/campay')
                .set('x-campay-signature', invalidSig2)
                .send(payload);
            const time2 = Date.now() - start2;

            // Timing difference should be small (within 100ms) due to constant-time comparison
            expect(Math.abs(time1 - time2)).toBeLessThan(100);
        });

        it('should reject empty signature', async () => {
            if (!config.CAMPAY_WEBHOOK_SECRET) {
                return;
            }

            const payload = {
                reference: 'CAMP111',
                external_reference: 'test-uuid-111',
                status: 'SUCCESSFUL'
            };

            const res = await request(app)
                .post('/webhook/campay')
                .set('x-campay-signature', '')
                .send(payload);

            expect(res.statusCode).toBe(401);
        });

        it('should handle malformed signature gracefully', async () => {
            if (!config.CAMPAY_WEBHOOK_SECRET) {
                return;
            }

            const payload = {
                reference: 'CAMP222',
                external_reference: 'test-uuid-222',
                status: 'SUCCESSFUL'
            };

            const res = await request(app)
                .post('/webhook/campay')
                .set('x-campay-signature', 'not-even-hex!')
                .send(payload);

            expect(res.statusCode).toBe(401);
        });
    });
});
