// Shared between scripts/submitCarouselTemplate.js (which bakes this suffix
// into the approved template's static BODY text at submission time) and
// flowEngine.js's config validation (which enforces the resulting variable
// budget at flow-load time). Keeping both in one place prevents them
// drifting apart the way the runtime data and the approved template already
// did once - see docs/requirements/afromarket.md v2.15.
//
// Every carousel card template is submitted with a BODY of
// `{{1}}${CARD_BODY_STATIC_SUFFIX}` (see submitCarouselTemplate.js) - Meta
// hydrates {{1}} with the card's runtime bodyText and rejects the whole send
// with a 400 (#132018) if the hydrated result either exceeds
// CARD_BODY_HYDRATED_LIMIT characters or contains more than
// CARD_BODY_HYDRATED_MAX_LINE_BREAKS line breaks - both confirmed against the
// real API (afromarket_restaurants_v2/afromarket_partner_stores_v2), not
// documented anywhere with an exact threshold.
const CARD_BODY_STATIC_SUFFIX = '\n\nTap the button below for more details.';
const CARD_BODY_HYDRATED_LIMIT = 160;
const CARD_BODY_HYDRATED_MAX_LINE_BREAKS = 2;
const CARD_BODY_STATIC_SUFFIX_LINE_BREAKS = (CARD_BODY_STATIC_SUFFIX.match(/\n/g) || []).length;

const CARD_BODY_VARIABLE_LIMIT = CARD_BODY_HYDRATED_LIMIT - CARD_BODY_STATIC_SUFFIX.length;
const CARD_BODY_VARIABLE_MAX_LINE_BREAKS = CARD_BODY_HYDRATED_MAX_LINE_BREAKS - CARD_BODY_STATIC_SUFFIX_LINE_BREAKS;

module.exports = {
  CARD_BODY_STATIC_SUFFIX,
  CARD_BODY_HYDRATED_LIMIT,
  CARD_BODY_VARIABLE_LIMIT,
  CARD_BODY_VARIABLE_MAX_LINE_BREAKS
};
