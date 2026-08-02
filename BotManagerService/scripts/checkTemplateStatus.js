/**
 * Check the review status of a submitted WhatsApp message template.
 * Usage: node scripts/checkTemplateStatus.js <template-name>
 */
require('dotenv').config();

const WABA_ID = process.env.AFROMARKET_WABA_ID || '4464369590494418';

async function main() {
  const templateName = process.argv[2];
  if (!templateName) {
    console.error('Usage: node scripts/checkTemplateStatus.js <template-name>');
    process.exitCode = 1;
    return;
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN_AFROMARKET;
  if (!token) {
    throw new Error('WHATSAPP_ACCESS_TOKEN_AFROMARKET is not set');
  }

  const res = await fetch(
    `https://graph.facebook.com/v20.0/${WABA_ID}/message_templates?name=${encodeURIComponent(templateName)}`,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  const body = await res.json();
  const template = body.data && body.data[0];
  if (!template) {
    console.log('Template not found:', JSON.stringify(body, null, 2));
    return;
  }
  console.log(`${template.name}: ${template.status} (id ${template.id}, category ${template.category})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
