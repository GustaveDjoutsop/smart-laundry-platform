const axios = require('axios');
const config = require('../config/env');

const API_VERSION = 'v18.0';
const WHATSAPP_API_URL = `https://graph.facebook.com/${API_VERSION}/${config.META_PHONE_ID}/messages`;

/**
 * Sends a text message using the WhatsApp Cloud API.
 * @param {string} to - The recipient's phone number.
 * @param {string} text - The message content to send.
 */
const sendMessage = async (to, text) => {
    try {
        await axios.post(WHATSAPP_API_URL, {
            messaging_product: 'whatsapp',
            to: to,
            text: {
                body: text
            }
        }, {
            headers: {
                'Authorization': `Bearer ${config.META_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ WhatsApp message sent to ${to}`);
    } catch (error) {
        console.error(`❌ WA Send Error for ${to}:`, error.response?.data || error.message);
    }
};

/**
 * Sends an interactive message with buttons using the WhatsApp Cloud API.
 * @param {string} to - The recipient's phone number.
 * @param {string} text - The main text content of the message.
 * @param {Array<object>} buttons - An array of button objects, e.g., [{ id: "btn_1", title: "Option 1" }]
 */
const sendButtons = async (to, text, buttons) => {
    try {
        await axios.post(WHATSAPP_API_URL, {
            messaging_product: "whatsapp",
            to: to,
            type: "interactive",
            interactive: {
                type: "button",
                body: { text: text },
                action: {
                    buttons: buttons.map(b => ({
                        type: "reply",
                        reply: { id: b.id, title: b.title }
                    }))
                }
            }
        }, {
            headers: {
                'Authorization': `Bearer ${config.META_TOKEN}`,
                'Content-Type': 'application/json'
            }
        });
        console.log(`✅ WhatsApp button message sent to ${to}`);
    } catch (error) {
        console.error(`❌ WA Button Error for ${to}:`, error.response?.data || error.message);
    }
};

module.exports = { sendMessage, sendButtons };