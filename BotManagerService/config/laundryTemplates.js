/**
 * WhatsApp message template definitions for Smart Laundry marketing.
 *
 * These templates must be submitted to Meta Business Manager for review and
 * approval before they can be used in outbound messages. Approval is
 * independent of the product catalog (see config/laundryCatalog.js) —
 * submitting a template does NOT create or populate a Meta catalog.
 *
 * Two templates are defined:
 *
 *   laundry_welcome_promo — Catalog-opening welcome message sent when a
 *     customer opens the catalog or starts a session. Image header + static
 *     body pointing them toward the service list + a QUICK_REPLY button.
 *
 *   laundry_weekly_promo — Weekly promotional blast. Image header + dynamic
 *     body with {{1}}=discountPercent and {{2}}=serviceName so the featured
 *     service and discount can be varied at send time without resubmitting
 *     the template. Same "vary at send time, not template-definition time"
 *     discipline as submitCarouselTemplate.js and submitPromoTemplate.js.
 *
 * IMPORTANT: Meta only allows MARKETING category for promotional templates
 * that are not strictly transactional. Both templates here are MARKETING.
 * Template names must be lowercase with underscores and ≤512 characters.
 *
 * See CATALOG_SETUP.md for submission instructions and the separation
 * between catalog data, approved templates, and order handling.
 */

const TEMPLATES = Object.freeze({
  /**
   * Welcome / catalog-opening message.
   * Body is fully static — no variables, so no example needed.
   */
  WELCOME_PROMO: {
    name: 'laundry_welcome_promo',
    language: 'en_US',
    category: 'MARKETING',
    // Header image supplied at submit time via --image-path CLI arg
    bodyText:
      'Welcome to Smart Laundry! 👕✨\n\n' +
      'We offer washing, dry cleaning, ironing, and household textile care — ' +
      'all in one place. Browse our services below and tap to book directly via WhatsApp.',
    buttonText: 'See Services',
    buttonType: 'QUICK_REPLY'
  },

  /**
   * Weekly promotional blast.
   * {{1}} = discount percentage (e.g. "20")
   * {{2}} = service name (e.g. "Standard Machine Wash")
   * Body example is provided to satisfy Meta's template review requirement.
   */
  WEEKLY_PROMO: {
    name: 'laundry_weekly_promo',
    language: 'en_US',
    category: 'MARKETING',
    // Header image supplied at submit time via --image-path CLI arg
    bodyText:
      '🎉 This week only: {{1}}% off {{2}}!\n\n' +
      'Tap the button below to book now — offer ends Sunday.',
    bodyExample: ['20', 'Standard Machine Wash'],
    buttonText: 'Book Now',
    buttonType: 'QUICK_REPLY'
  }
});

/**
 * Builds the Meta API template submission payload for a given template key.
 *
 * @param {'WELCOME_PROMO'|'WEEKLY_PROMO'} templateKey
 * @param {string} headerHandle - The upload handle for the header image
 *   (returned by the Graph API /uploads endpoint).
 * @returns {object} Ready-to-POST template body for the message_templates API.
 */
function buildTemplatePayload(templateKey, headerHandle) {
  const template = TEMPLATES[templateKey];
  if (!template) {
    throw new Error(`Unknown template key "${templateKey}". Valid keys: ${Object.keys(TEMPLATES).join(', ')}`);
  }

  const bodyComponent = {
    type: 'BODY',
    text: template.bodyText,
    ...(template.bodyExample ? { example: { body_text: [template.bodyExample] } } : {})
  };

  const buttonComponent = {
    type: 'BUTTONS',
    buttons: [{ type: template.buttonType, text: template.buttonText }]
  };

  return {
    name: template.name,
    language: template.language,
    category: template.category,
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [headerHandle] } },
      bodyComponent,
      buttonComponent
    ]
  };
}

module.exports = { TEMPLATES, buildTemplatePayload };
