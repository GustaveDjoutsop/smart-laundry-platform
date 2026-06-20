/**
 * Configuration Loader
 *
 * Loads configuration from YAML files based on NODE_ENV:
 * 1. Loads base values.yml (shared defaults)
 * 2. Merges with environment-specific config (dev.yml, test.yml, stage.yml, prod.yml)
 * 3. Environment variables override YAML values (for secrets)
 *
 * Usage:
 *   const config = require('./config');
 *   console.log(config.pricing.short_cycle);
 */

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

// Load dotenv for environment variable overrides
require('dotenv').config({ override: true });

const NODE_ENV = process.env.NODE_ENV || 'development';

// Map NODE_ENV to config file names
const ENV_FILE_MAP = {
    'development': 'dev.yml',
    'test': 'test.yml',
    'stage': 'stage.yml',
    'staging': 'stage.yml',
    'production': 'prod.yml',
    'prod': 'prod.yml'
};

/**
 * Deep merge two objects
 */
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

/**
 * Replace ${VAR} placeholders with environment variables
 */
function resolveEnvVars(obj) {
    if (typeof obj === 'string') {
        return obj.replace(/\$\{(\w+)\}/g, (match, varName) => {
            return process.env[varName] || match;
        });
    }
    if (Array.isArray(obj)) {
        return obj.map(item => resolveEnvVars(item));
    }
    if (obj && typeof obj === 'object') {
        const result = {};
        for (const key in obj) {
            result[key] = resolveEnvVars(obj[key]);
        }
        return result;
    }
    return obj;
}

/**
 * Load and parse a YAML file
 */
function loadYamlFile(filePath) {
    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf8');
            return yaml.load(content) || {};
        }
    } catch (error) {
        console.warn(`Warning: Could not load config file ${filePath}:`, error.message);
    }
    return {};
}

// Load configuration files
const configDir = path.join(__dirname, 'environments');
const baseConfig = loadYamlFile(path.join(configDir, 'values.yml'));
const envFileName = ENV_FILE_MAP[NODE_ENV] || 'dev.yml';
const envConfig = loadYamlFile(path.join(configDir, envFileName));

// Merge base with environment-specific config
let config = deepMerge(baseConfig, envConfig);

// Resolve environment variable placeholders
config = resolveEnvVars(config);

// Add computed values and environment detection
config.NODE_ENV = NODE_ENV;
config.IS_PRODUCTION = NODE_ENV === 'production';
config.IS_STAGE = NODE_ENV === 'stage' || NODE_ENV === 'staging';
config.IS_TEST = NODE_ENV === 'test';
config.IS_DEVELOPMENT = NODE_ENV === 'development';

// Override with direct environment variables (secrets should always come from env vars)
const envOverrides = {
    // Database
    database: {
        uri: process.env.MONGO_URI || config.database?.uri
    },

    // MQTT
    mqtt: {
        broker_url: process.env.MQTT_BROKER_URL || config.mqtt?.broker_url,
        username: process.env.MQTT_USERNAME || config.mqtt?.username,
        password: process.env.MQTT_PASSWORD || config.mqtt?.password
    },

    // Payment - Campay
    payment: {
        provider: process.env.PAYMENT_PROVIDER || config.payment?.provider,
        campay: {
            api_url: process.env.CAMPAY_API_URL || config.payment?.campay?.api_url,
            app_key: process.env.CAMPAY_APP_KEY,
            app_secret: process.env.CAMPAY_APP_SECRET,
            webhook_secret: process.env.CAMPAY_WEBHOOK_SECRET
        },
        mtn: {
            api_url: process.env.MTN_API_URL || config.payment?.mtn?.api_url,
            subscription_key: process.env.MTN_SUBSCRIPTION_KEY,
            api_user_id: process.env.MTN_API_USER_ID,
            api_key: process.env.MTN_API_KEY,
            env: process.env.MTN_ENV || config.payment?.mtn?.env
        }
    },

    // WhatsApp
    whatsapp: {
        token: process.env.WHATSAPP_TOKEN,
        phone_id: process.env.WHATSAPP_PHONE_ID,
        verify_token: process.env.WHATSAPP_VERIFY_TOKEN,
        api_version: config.whatsapp?.api_version || 'v18.0'
    },

    // Server
    server: {
        port: parseInt(process.env.PORT || config.server?.port || 3000)
    },

    // Pricing (env vars override yaml)
    pricing: {
        short_cycle: parseInt(process.env.PRICE_SHORT_CYCLE || config.pricing?.short_cycle || 1000),
        long_cycle: parseInt(process.env.PRICE_LONG_CYCLE || config.pricing?.long_cycle || 2000)
    },

    // Alerts
    alerts: {
        staff_phone: process.env.STAFF_ALERT_PHONE || config.alerts?.staff_phone
    }
};

// Deep merge overrides
config = deepMerge(config, envOverrides);

// Log loaded configuration (in development only)
if (config.IS_DEVELOPMENT) {
    console.log(`📁 Config loaded: ${envFileName} (${NODE_ENV})`);
}

module.exports = config;
