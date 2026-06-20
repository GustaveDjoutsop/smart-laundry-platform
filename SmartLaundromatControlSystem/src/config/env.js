/**
 * Environment configuration module
 *
 * Loads configuration from YAML files in /config/environments/ based on NODE_ENV:
 * - values.yml: Base/shared configuration
 * - dev.yml: Development environment
 * - test.yml: Test/CI environment
 * - stage.yml: Staging/UAT environment
 * - prod.yml: Production environment
 *
 * Environment variables override YAML values for secrets and sensitive data.
 */

const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');

require('dotenv').config({ override: true });

const NODE_ENV = process.env.NODE_ENV || 'development';

// ============================================
// YAML Configuration Loader
// ============================================

const ENV_FILE_MAP = {
    'development': 'dev.yml',
    'test': 'test.yml',
    'cicd': 'cicd.yml',
    'stage': 'stage.yml',
    'staging': 'stage.yml',
    'production': 'prod.yml',
    'prod': 'prod.yml'
};

function loadYamlFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return yaml.load(content) || {};
        }
    } catch (error) {
        // Silently fall back to defaults if YAML files don't exist
    }
    return {};
}

function deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else {
            result[key] = source[key];
        }
    }
    return result;
}

// Load YAML configs
const configDir = path.join(__dirname, '../../config/environments');
const baseConfig = loadYamlFile(path.join(configDir, 'values.yml'));
const envFileName = ENV_FILE_MAP[NODE_ENV] || 'dev.yml';
const envConfig = loadYamlFile(path.join(configDir, envFileName));
const yamlConfig = deepMerge(baseConfig, envConfig);

// Set JWT_SECRET from YAML config if not already set (for test/cicd environments)
// This allows authService.js to load without error in test environments
if (!process.env.JWT_SECRET && yamlConfig.security?.jwt_secret) {
    process.env.JWT_SECRET = yamlConfig.security.jwt_secret;
    console.log('🔐 JWT_SECRET loaded from YAML configuration');
}

// Log config source in development
if (NODE_ENV === 'development' && Object.keys(yamlConfig).length > 0) {
    console.log(`📁 Config loaded from: config/environments/${envFileName}`);
}

// ============================================
// Environment-specific API URLs
// ============================================

const CAMPAY_URLS = {
    development: 'https://demo.campay.net',
    test: 'https://demo.campay.net',
    stage: process.env.CAMPAY_BASE_URL || yamlConfig.payment?.campay?.api_url || 'https://www.campay.net',
    production: 'https://www.campay.net'
};

const MTN_URLS = {
    development: 'https://sandbox.momodeveloper.mtn.com',
    test: 'https://sandbox.momodeveloper.mtn.com',
    stage: 'https://sandbox.momodeveloper.mtn.com',
    production: 'https://proxy.momoapi.mtn.com'
};

// ============================================
// Export Configuration (backward compatible)
// ============================================

module.exports = {
    // Environment Detection
    NODE_ENV,
    get IS_PRODUCTION() {
        return NODE_ENV === 'production';
    },
    get IS_STAGE() {
        return NODE_ENV === 'stage' || NODE_ENV === 'staging';
    },
    get IS_TEST() {
        return NODE_ENV === 'test';
    },
    get IS_CICD() {
        return NODE_ENV === 'cicd';
    },
    get IS_DEVELOPMENT() {
        return NODE_ENV === 'development';
    },

    // Server Configuration
    PORT: parseInt(process.env.PORT || yamlConfig.server?.port || 3000),

    // Database
    MONGO_URI: process.env.MONGO_URI || yamlConfig.database?.uri,

    // MQTT Broker
    MQTT_BROKER: process.env.MQTT_BROKER_URL || yamlConfig.mqtt?.broker_url,
    MQTT_USERNAME: process.env.MQTT_USERNAME || yamlConfig.mqtt?.username,
    MQTT_PASSWORD: process.env.MQTT_PASSWORD || yamlConfig.mqtt?.password,

    // Payment Provider Selection (campay or mtn)
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER || yamlConfig.payment?.provider || 'campay',

    // Campay Payment Gateway
    CAMPAY_KEY: process.env.CAMPAY_APP_KEY,
    CAMPAY_SECRET: process.env.CAMPAY_APP_SECRET,
    CAMPAY_BASE_URL: process.env.CAMPAY_API_URL || CAMPAY_URLS[NODE_ENV],
    CAMPAY_WEBHOOK_SECRET: process.env.CAMPAY_WEBHOOK_SECRET,

    // MTN Mobile Money API
    MTN_API_URL: process.env.MTN_API_URL || MTN_URLS[NODE_ENV],
    MTN_SUBSCRIPTION_KEY: process.env.MTN_SUBSCRIPTION_KEY,
    MTN_API_USER_ID: process.env.MTN_API_USER_ID,
    MTN_API_KEY: process.env.MTN_API_KEY,
    MTN_ENV: process.env.MTN_ENV || yamlConfig.payment?.mtn?.env || 'sandbox',

    // WhatsApp (Meta) API
    META_TOKEN: process.env.WHATSAPP_TOKEN,
    META_PHONE_ID: process.env.WHATSAPP_PHONE_ID,
    META_VERIFY: process.env.WHATSAPP_VERIFY_TOKEN,
    META_APP_SECRET: process.env.WHATSAPP_APP_SECRET || yamlConfig.whatsapp?.app_secret, // App secret for webhook signature validation
    // WhatsApp Business phone number for QR code deep links (format: country code + number, no +)
    WHATSAPP_BUSINESS_PHONE: process.env.WHATSAPP_BUSINESS_PHONE || '15556089484',

    // Staff Alert Configuration (for low rating notifications)
    STAFF_ALERT_PHONE: process.env.STAFF_ALERT_PHONE || yamlConfig.alerts?.staff_phone,

    // Business Configuration - Pricing
    PRICING: {
        SHORT_CYCLE: parseInt(process.env.PRICE_SHORT_CYCLE || yamlConfig.pricing?.short_cycle || 1000),
        LONG_CYCLE: parseInt(process.env.PRICE_LONG_CYCLE || yamlConfig.pricing?.long_cycle || 2000)
    },

    // Cycle Configuration
    CYCLES: {
        SHORT: {
            duration: process.env.DURATION_SHORT || yamlConfig.cycles?.short?.duration || '30',
            pulseCount: parseInt(process.env.PULSE_SHORT || yamlConfig.cycles?.short?.pulse_count || 1)
        },
        LONG: {
            duration: process.env.DURATION_LONG || yamlConfig.cycles?.long?.duration || '60',
            pulseCount: parseInt(process.env.PULSE_LONG || yamlConfig.cycles?.long?.pulse_count || 2)
        }
    },

    // Machine Configuration
    MACHINES: {
        AVAILABLE_MACHINES: process.env.MACHINE_IDS
            ? process.env.MACHINE_IDS.split(',').map(id => id.trim())
            : yamlConfig.machines?.available || [
                'washer_01', 'washer_02', 'washer_03', 'washer_04', 'washer_05', 'washer_06',
                'dryer_01', 'dryer_02', 'dryer_03', 'dryer_04'
            ]
    },

    // Business Hours Configuration
    BUSINESS_HOURS: {
        OPEN_TIME: process.env.BUSINESS_OPEN_TIME || yamlConfig.business_hours?.open_time || '07:00',
        CLOSE_TIME: process.env.BUSINESS_CLOSE_TIME || yamlConfig.business_hours?.close_time || '22:00',
        CLOSING_BUFFER_MINUTES: parseInt(process.env.CLOSING_BUFFER_MINUTES || yamlConfig.business_hours?.closing_buffer_minutes || 15),
        TIMEZONE: process.env.BUSINESS_TIMEZONE || yamlConfig.business_hours?.timezone || 'Africa/Douala'
    },

    // Monitoring Configuration (from YAML)
    MONITORING: {
        CYCLE_CHECK_INTERVAL: yamlConfig.monitoring?.cycle_check_interval || 60,
        FEEDBACK_CHECK_INTERVAL: yamlConfig.monitoring?.feedback_check_interval || 60,
        FEEDBACK_DELAY_AFTER_CYCLE: yamlConfig.monitoring?.feedback_delay_after_cycle || 30
    },

    // Feedback Configuration (from YAML)
    FEEDBACK: {
        LOW_RATING_THRESHOLD: yamlConfig.feedback?.low_rating_threshold || 3
    },

    // Logging Configuration (from YAML)
    LOGGING: {
        LEVEL: yamlConfig.logging?.level || (NODE_ENV === 'production' ? 'info' : 'debug'),
        INCLUDE_REQUEST_BODY: yamlConfig.logging?.include_request_body ?? (NODE_ENV !== 'production')
    },

    // Raw YAML config access (for advanced use)
    _yaml: yamlConfig
};

// ============================================
// Environment Variable Validation
// ============================================

function validateRequiredEnvVars() {
    const errors = [];
    const config = module.exports;

    // Critical for all environments
    if (!process.env.JWT_SECRET) {
        errors.push('JWT_SECRET is required (generate with: openssl rand -hex 32)');
    }

    if (!config.MONGO_URI) {
        errors.push('MONGO_URI is required (either set MONGO_URI env var or configure in YAML)');
    }

    // Production and staging requirements
    if (config.IS_PRODUCTION || config.IS_STAGE) {
        // CORS configuration validation
        if (!process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ALLOWED_ORIGINS.trim() === '') {
            errors.push('CORS_ALLOWED_ORIGINS is required in production (comma-separated list of allowed origins)');
        }

        // Payment provider validation
        if (config.PAYMENT_PROVIDER === 'campay') {
            if (!config.CAMPAY_KEY) errors.push('CAMPAY_APP_KEY is required for Campay payments');
            if (!config.CAMPAY_SECRET) errors.push('CAMPAY_APP_SECRET is required for Campay payments');
            if (!config.CAMPAY_WEBHOOK_SECRET) errors.push('CAMPAY_WEBHOOK_SECRET is required for webhook signature validation');
        } else if (config.PAYMENT_PROVIDER === 'mtn') {
            if (!config.MTN_SUBSCRIPTION_KEY) errors.push('MTN_SUBSCRIPTION_KEY is required for MTN payments');
            if (!config.MTN_API_USER_ID) errors.push('MTN_API_USER_ID is required for MTN payments');
            if (!config.MTN_API_KEY) errors.push('MTN_API_KEY is required for MTN payments');
        }

        // WhatsApp API validation
        if (!config.META_TOKEN) errors.push('WHATSAPP_TOKEN is required for WhatsApp integration');
        if (!config.META_PHONE_ID) errors.push('WHATSAPP_PHONE_ID is required for WhatsApp integration');
        if (!config.META_VERIFY) errors.push('WHATSAPP_VERIFY_TOKEN is required for WhatsApp webhook verification');

        // MQTT validation
        if (!config.MQTT_BROKER) errors.push('MQTT_BROKER_URL is required for machine control');
    }

    // Fail fast if critical variables are missing
    if (errors.length > 0) {
        console.error('\n❌ FATAL: Missing required environment variables:\n');
        errors.forEach(err => console.error(`   - ${err}`));
        console.error('\n💡 See .env.example for required variables\n');
        throw new Error(`Configuration validation failed: ${errors.length} required variable(s) missing`);
    }

    // Success message in development
    if (config.IS_DEVELOPMENT) {
        console.log('✅ Environment configuration validated successfully');
    }
}

// Run validation on module load (except in test and cicd environments)
// Test and CI/CD environments use test credentials from YAML
if (!module.exports.IS_TEST && !module.exports.IS_CICD) {
    validateRequiredEnvVars();
}
