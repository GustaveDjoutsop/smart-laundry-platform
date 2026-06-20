/**
 * Internationalization (i18n) helper for WhatsApp Bot
 */

const translations = require('../locales/translations');

// Default language
const DEFAULT_LANGUAGE = 'en';

// Supported languages
const SUPPORTED_LANGUAGES = ['en', 'fr'];

/**
 * Get translated message by key
 * @param {string} key - Translation key
 * @param {string} lang - Language code ('en' or 'fr')
 * @param {object} params - Optional parameters for string interpolation
 * @returns {string} - Translated message
 */
const t = (key, lang = DEFAULT_LANGUAGE, params = {}) => {
    // Validate language
    const language = SUPPORTED_LANGUAGES.includes(lang) ? lang : DEFAULT_LANGUAGE;

    // Get translation
    const translation = translations[key];
    if (!translation) {
        console.warn(`⚠️ Missing translation key: ${key}`);
        return key;
    }

    let message = translation[language] || translation[DEFAULT_LANGUAGE] || key;

    // Replace placeholders with params
    // Supports {placeholder} format
    Object.keys(params).forEach(param => {
        message = message.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
    });

    return message;
};

/**
 * Check if a language is supported
 * @param {string} lang - Language code
 * @returns {boolean}
 */
const isSupported = (lang) => {
    return SUPPORTED_LANGUAGES.includes(lang);
};

/**
 * Get list of supported languages
 * @returns {string[]}
 */
const getSupportedLanguages = () => {
    return [...SUPPORTED_LANGUAGES];
};

module.exports = {
    t,
    isSupported,
    getSupportedLanguages,
    DEFAULT_LANGUAGE,
    SUPPORTED_LANGUAGES
};
