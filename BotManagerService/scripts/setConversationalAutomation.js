/**
 * Read or update a WhatsApp Business phone number's "conversational
 * automation" settings - this is the Graph API field behind Meta's Ice
 * Breakers (pre-chat suggested-reply buttons, the `prompts` array) and the
 * WhatsApp Business App's "/" commands menu (`commands`), plus
 * `enable_welcome_message`, which - once true - makes Meta send a
 * `request_welcome` webhook event the moment a customer opens the chat,
 * before they've typed anything. That event is how Template 1's catalog
 * welcome message actually gets to be the first thing a new customer sees,
 * replacing Ice Breakers rather than just reacting to their first text -
 * see docs/requirements/afromarket.md v2.16 and
 * afromarket-dynamic-templates-todo.md.
 *
 * Usage:
 *   node scripts/setConversationalAutomation.js get <phone-number-id>
 *   node scripts/setConversationalAutomation.js clear-ice-breakers <phone-number-id>
 *     Sets prompts: [] (removes Ice Breaker buttons) and
 *     enable_welcome_message: true (turns on the request_welcome event),
 *     leaving commands untouched (pass --clear-commands to also empty
 *     those).
 *
 * Requires WHATSAPP_ACCESS_TOKEN_AFROMARKET (env or .env) with
 * whatsapp_business_management scope on the target phone number.
 *
 * Two real WABAs exist for AfroMarket (sandbox test number vs the
 * K-AfroMarket production number, see submitCarouselTemplate.js's file
 * header) - this script takes a phone-number-id directly rather than
 * defaulting to one, since getting this wrong on the wrong number is an
 * outward-facing, immediately customer-visible change. Run against each
 * number explicitly.
 */
require('dotenv').config();

async function getConversationalAutomation(token, phoneNumberId) {
  const res = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}?fields=conversational_automation`,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  const body = await res.json();
  return { status: res.status, body };
}

// This is a dedicated sub-resource endpoint, NOT a field on
// POST /{phone-number-id} - confirmed against Meta's own Conversational
// Automation API reference after an earlier version of this script posted
// to the wrong endpoint (POST /{phone-number-id} with a nested
// conversational_automation body) and got a misleading {success: true}
// back on every call without the setting ever actually taking effect (GET
// kept showing the old value indefinitely - not a propagation delay, a
// wrong URL). See docs/requirements/afromarket.md v2.19.
async function setConversationalAutomation(token, phoneNumberId, payload) {
  const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/conversational_automation`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await res.json();
  return { status: res.status, body };
}

async function main() {
  const [command, phoneNumberId, ...rest] = process.argv.slice(2);
  if (!command || !phoneNumberId) {
    console.error(
      'Usage:\n' +
        '  node scripts/setConversationalAutomation.js get <phone-number-id>\n' +
        '  node scripts/setConversationalAutomation.js clear-ice-breakers <phone-number-id> [--clear-commands]'
    );
    process.exitCode = 1;
    return;
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN_AFROMARKET;
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN_AFROMARKET is not set');
  }

  if (command === 'get') {
    const { status, body } = await getConversationalAutomation(token, phoneNumberId);
    console.log('status:', status);
    console.log(JSON.stringify(body, null, 2));
    if (status !== 200) process.exitCode = 1;
    return;
  }

  if (command === 'clear-ice-breakers') {
    const clearCommands = rest.includes('--clear-commands');
    // Fields go directly in the body at this endpoint - no
    // messaging_product/conversational_automation wrapper (that wrapper
    // belonged to the wrong endpoint this script used to hit).
    const payload = {
      enable_welcome_message: true,
      prompts: []
    };
    if (clearCommands) payload.commands = [];

    const { status, body } = await setConversationalAutomation(token, phoneNumberId, payload);
    console.log('status:', status);
    console.log(JSON.stringify(body, null, 2));
    if (status !== 200 || !body.success) {
      throw new Error(`conversational_automation update failed: ${JSON.stringify(body)}`);
    }
    return;
  }

  console.error(`Unknown command "${command}" - use "get" or "clear-ice-breakers"`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
