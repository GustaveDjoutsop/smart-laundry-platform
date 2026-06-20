const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('./config/env');
const connectDB = require('./config/database');
const mqttService = require('./services/mqttService');
const cycleMonitorService = require('./services/cycleMonitorService');
const feedbackService = require('./services/feedbackService');
const paymentTimeoutService = require('./services/paymentTimeoutService');
const webhookController = require('./controllers/webhookController');
const paymentController = require('./controllers/paymentController');
const adminRoutes = require('./routes/adminRoutes');
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const timekeepingRoutes = require('./routes/timekeepingRoutes');
const absenceRoutes = require('./routes/absenceRoutes');
const { startIfEnabled: startSimulatorIfEnabled } = require('./simulator/embeddedSimulator');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// --- Security Middleware ---

// Trust proxy - Required for proper HTTPS detection behind reverse proxies (Heroku, AWS ALB, nginx)
if (config.IS_PRODUCTION) {
    app.set('trust proxy', true);
}

// HTTPS Enforcement (redirect HTTP to HTTPS in production)
if (config.IS_PRODUCTION) {
    app.use((req, res, next) => {
        // Check if request is already HTTPS or from a trusted proxy
        if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
            return next();
        }
        // Derive and validate host from the request to prevent open redirect vulnerabilities
        const rawHost = req.get('host');
        const hostPattern = /^[a-zA-Z0-9.-]+(?::\d+)?$/;
        const fallbackHost = 'localhost';
        const safeHost = rawHost && hostPattern.test(rawHost) ? rawHost : fallbackHost;
        // Redirect to HTTPS using a validated host value
        res.redirect(301, `https://${safeHost}${req.url}`);
    });
}

// Helmet: Security headers (CSP, HSTS, X-Frame-Options, etc.)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", 'data:', 'https:'],
        }
    },
    hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        // Enable HSTS preload only when explicitly configured in production
        preload: config.IS_PRODUCTION && process.env.HSTS_PRELOAD === 'true'
    }
}));

// CORS: Configure allowed origins (whitelist)
const corsOptions = {
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);

        // In development/test, allow all origins
        if (config.IS_DEVELOPMENT || config.IS_TEST || config.IS_CICD) {
            return callback(null, true);
        }

        // Production: check whitelist
        // Note: CORS_ALLOWED_ORIGINS is validated at startup in env.js for production/staging
        const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS
            ? process.env.CORS_ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
            : [];

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn(`⚠️  CORS blocked origin: ${origin}`);
            // Return a proper CORS error without using Error object
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));

// Rate Limiting: Protect against DDoS attacks
const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per window
    message: { error: 'Too many requests, please try again later.' },
    standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
    legacyHeaders: false, // Disable `X-RateLimit-*` headers
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 auth requests per window
    message: { error: 'Too many authentication attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Only count failed attempts for better brute-force protection
});

// Webhook rate limiter: More lenient for external services (payment providers, WhatsApp)
const webhookLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 300, // Higher limit for high-volume webhook scenarios
    message: { error: 'Too many webhook requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Payment rate limiter: Protect payment initiation endpoint
const paymentLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 5, // Limit each IP to 5 payment attempts per minute
    message: { error: 'Too many payment attempts, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
});

// Apply global rate limiter to all requests
app.use(globalLimiter);

// Apply strict rate limiter to auth routes
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/refresh', authLimiter);

// --- Body Parsing Middleware ---
// IMPORTANT: Keep a copy of the raw request body for webhook signature validation.
// Meta (WhatsApp) signs the raw bytes, not a re-serialized JSON object.
app.use(express.json({
    limit: '1mb',
    verify: (req, res, buf) => {
        req.rawBody = buf; // Buffer
    }
})); // Parse JSON bodies with size limit to prevent DoS

// Debug logger for all requests
app.use((req, res, next) => {
    console.log(`📥 ${req.method} ${req.path}`);
    next();
});

// --- Database & Service Initialization ---
connectDB();

// Initialize Services
mqttService.connectMQTT();
cycleMonitorService.startMonitor();
feedbackService.startFeedbackMonitor();
paymentTimeoutService.startPaymentTimeoutMonitor();

// Start embedded simulator if enabled (TEST environment)
const simulator = startSimulatorIfEnabled(config._yaml);
if (simulator) {
    // Connect simulator telemetry to MQTT service for internal processing
    simulator.on('telemetry', (machineId, data) => {
        mqttService.handleSimulatedTelemetry(machineId, data);
    });

    // Route commands from MQTT service to the embedded simulator
    // This ensures pulse commands reach the simulator when not using real MQTT
    mqttService.onCommand((machineId, command) => {
        simulator.handleCommand(machineId, command);
    });
}

// --- API Routes ---
// Health check endpoints (both paths for compatibility)
app.get('/health', (req, res) => res.status(200).json({ status: 'UP' }));
app.get('/api/health', (req, res) => res.status(200).json({ status: 'UP' }));

// Payment initiation route (simulates user action) with rate limiting
app.post('/api/pay', paymentLimiter, paymentController.initiatePayment);

// Webhook routes for external services (with lenient rate limiting)
app.post('/api/webhook/campay', webhookLimiter, webhookController.handleCampay);
app.post('/api/webhook/mtn', webhookLimiter, webhookController.handleMtn);
app.get('/api/mtn/status/:referenceId', webhookLimiter, webhookController.checkMtnStatus);
app.get('/api/webhook/whatsapp', webhookLimiter, webhookController.verifyWhatsApp);
app.post('/api/webhook/whatsapp', webhookLimiter, webhookController.handleWhatsApp);

// Authentication routes
app.use('/api/auth', authRoutes);

// User management routes
app.use('/api/users', userRoutes);

// Admin API routes (for management dashboard)
app.use('/api/admin', adminRoutes);

// Timekeeping routes (clock in/out, time entries)
app.use('/api/timekeeping', timekeepingRoutes);

// Absence routes (absence requests, approvals)
app.use('/api/absences', absenceRoutes);

// --- Error Handling Middleware (MUST be last) ---
// 404 handler for undefined routes
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

const server = app.listen(config.PORT, () => {
    if (process.env.NODE_ENV !== 'test') console.log(`🚀 Server running on port ${config.PORT}`);
});

module.exports = server; // Export for Testing
