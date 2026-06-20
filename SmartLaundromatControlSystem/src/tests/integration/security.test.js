const request = require('supertest');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { errorHandler, notFoundHandler } = require('../../middleware/errorHandler');

// Create a test app with security middleware
function createTestApp() {
    const app = express();

    // Helmet for security headers
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
            }
        }
    }));

    // CORS with options
    app.use(cors({
        origin: (origin, callback) => {
            if (!origin || origin === 'http://localhost:3000') {
                callback(null, true);
            } else {
                // Use callback(null, false) to match actual implementation
                callback(null, false);
            }
        },
        credentials: true
    }));

    // Rate limiting
    const limiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5, // Very low for testing
        message: { error: 'Too many requests' },
        standardHeaders: true,
        legacyHeaders: false
    });

    app.use('/api/limited', limiter);

    app.use(express.json());

    // Test routes
    app.get('/api/test', (req, res) => {
        res.json({ message: 'success' });
    });

    app.get('/api/limited', (req, res) => {
        res.json({ message: 'rate limited endpoint' });
    });

    app.get('/api/error', (req, res, next) => {
        const error = new Error('Test error');
        error.statusCode = 400;
        next(error);
    });

    // Error handlers
    app.use(notFoundHandler);
    app.use(errorHandler);

    return app;
}

describe('Security Features Integration', () => {
    let app;

    beforeEach(() => {
        app = createTestApp();
    });

    describe('Security Headers (Helmet)', () => {
        it('should set X-Content-Type-Options header', async () => {
            const res = await request(app).get('/api/test');

            expect(res.headers['x-content-type-options']).toBe('nosniff');
        });

        it('should set X-Frame-Options header', async () => {
            const res = await request(app).get('/api/test');

            expect(res.headers['x-frame-options']).toBeDefined();
        });

        it('should set X-DNS-Prefetch-Control header', async () => {
            const res = await request(app).get('/api/test');

            expect(res.headers['x-dns-prefetch-control']).toBe('off');
        });

        it('should set Content-Security-Policy header', async () => {
            const res = await request(app).get('/api/test');

            expect(res.headers['content-security-policy']).toBeDefined();
            expect(res.headers['content-security-policy']).toContain("default-src 'self'");
        });

        it('should set X-Download-Options header', async () => {
            const res = await request(app).get('/api/test');

            expect(res.headers['x-download-options']).toBe('noopen');
        });

        it('should set Strict-Transport-Security header', async () => {
            const res = await request(app).get('/api/test');

            // Note: HSTS header is typically only set on HTTPS connections
            // In test environment, helmet may not set it without HTTPS
            expect(res.headers['strict-transport-security']).toBeDefined();
        });
    });

    describe('CORS Configuration', () => {
        it('should allow requests from localhost', async () => {
            const res = await request(app)
                .get('/api/test')
                .set('Origin', 'http://localhost:3000');

            expect(res.statusCode).toBe(200);
            expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
        });

        it('should allow requests with no origin', async () => {
            const res = await request(app).get('/api/test');

            expect(res.statusCode).toBe(200);
        });

        it('should include credentials in CORS', async () => {
            const res = await request(app)
                .get('/api/test')
                .set('Origin', 'http://localhost:3000');

            expect(res.headers['access-control-allow-credentials']).toBe('true');
        });

        it('should block requests from disallowed origins', async () => {
            const res = await request(app)
                .get('/api/test')
                .set('Origin', 'https://evil.com');

            // When CORS blocks a request, the browser won't get CORS headers
            expect(res.headers['access-control-allow-origin']).toBeUndefined();
        });
    });

    describe('Rate Limiting', () => {
        it('should allow requests under the limit', async () => {
            // Create a fresh test app for this test to avoid state pollution
            const testApp = createTestApp();
            
            for (let i = 0; i < 5; i++) {
                const res = await request(testApp).get('/api/limited');
                expect(res.statusCode).toBe(200);
            }
        });

        it('should block requests over the limit', async () => {
            // Create a fresh test app for this test to avoid state pollution
            const testApp = createTestApp();
            
            // Make 5 requests (the limit)
            for (let i = 0; i < 5; i++) {
                await request(testApp).get('/api/limited');
            }

            // 6th request should be blocked
            const res = await request(testApp).get('/api/limited');
            expect(res.statusCode).toBe(429);
            expect(res.body.error).toContain('Too many requests');
        });

        it('should include rate limit headers', async () => {
            // Create a fresh test app for this test to avoid state pollution
            const testApp = createTestApp();
            
            const res = await request(testApp).get('/api/limited');

            expect(res.headers['ratelimit-limit']).toBeDefined();
            expect(res.headers['ratelimit-remaining']).toBeDefined();
            expect(res.headers['ratelimit-reset']).toBeDefined();
        });
    });

    describe('Error Handling', () => {
        it('should handle 404 Not Found', async () => {
            const res = await request(app).get('/api/nonexistent');

            expect(res.statusCode).toBe(404);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeDefined();
            expect(res.body.error).toContain('Route not found');
        });

        it('should handle application errors', async () => {
            const res = await request(app).get('/api/error');

            expect(res.statusCode).toBe(400);
            expect(res.body.success).toBe(false);
            expect(res.body.error).toBeDefined();
            expect(res.body.error).toBe('Test error');
        });

        it('should include timestamp in error response', async () => {
            const res = await request(app).get('/api/nonexistent');

            expect(res.body.timestamp).toBeDefined();
            expect(new Date(res.body.timestamp)).toBeInstanceOf(Date);
        });
    });
});
