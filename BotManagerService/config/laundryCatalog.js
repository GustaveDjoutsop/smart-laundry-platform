/**
 * Central catalog configuration for Smart Laundry's WhatsApp / Meta Commerce
 * Catalog integration.
 *
 * All image URLs are sourced from named environment variables so that no
 * private hosting URLs appear in source code. Set each LAUNDRY_IMG_*
 * variable to a publicly accessible HTTPS URL before running any catalog
 * sync script. Missing image variables are caught by validateCatalog()
 * (see services/catalogValidation.js) before any Meta API call is made.
 *
 * IMPORTANT: This module configures the catalog data sent to Meta. It has
 * nothing to do with WhatsApp message templates (see config/laundryTemplates.js)
 * or order handling (see src/bots/laundry/). Those are separate concerns -
 * see CATALOG_SETUP.md for the full picture.
 */

/** @readonly */
const CATEGORIES = Object.freeze({
  WASHING: { id: 'washing', name: 'Washing' },
  DRY_CLEANING: { id: 'dry_cleaning', name: 'Dry Cleaning' },
  IRONING: { id: 'ironing', name: 'Ironing' },
  HOUSEHOLD: { id: 'household', name: 'Household Textiles' },
  PROMOTIONS: { id: 'promotions', name: 'Promotions' }
});

/**
 * Returns the catalog product list, with image URLs resolved from env vars.
 * Call this inside a function (not at module load time) so that .env loading
 * by dotenv has already run before the values are read.
 *
 * @returns {{ categories: object[], products: object[] }}
 */
function getCatalog() {
  return {
    currency: 'EUR',
    categories: Object.values(CATEGORIES),
    products: [
      // ── Washing ──────────────────────────────────────────────────────────
      {
        retailerId: 'laundry-wash-standard',
        name: 'Standard Machine Wash',
        description: 'Full machine wash cycle, up to 5 kg. Fresh and clean in under an hour.',
        categoryId: CATEGORIES.WASHING.id,
        price: 5.50,
        currency: 'EUR',
        imageUrl: process.env.LAUNDRY_IMG_WASH_STANDARD,
        availability: 'in stock'
      },
      {
        retailerId: 'laundry-wash-express',
        name: 'Express Machine Wash',
        description: 'Fast 30-minute cycle for lightly soiled laundry, up to 3 kg.',
        categoryId: CATEGORIES.WASHING.id,
        price: 4.00,
        currency: 'EUR',
        imageUrl: process.env.LAUNDRY_IMG_WASH_EXPRESS,
        availability: 'in stock'
      },
      {
        retailerId: 'laundry-wash-large',
        name: 'Large Load Machine Wash',
        description: 'Heavy-duty cycle for bulky loads up to 10 kg.',
        categoryId: CATEGORIES.WASHING.id,
        price: 8.00,
        currency: 'EUR',
        imageUrl: process.env.LAUNDRY_IMG_WASH_LARGE,
        availability: 'in stock'
      },
      // ── Dry Cleaning ─────────────────────────────────────────────────────
      {
        retailerId: 'laundry-dry-suit',
        name: 'Dry Clean – Suit (2 pieces)',
        description: 'Professional dry cleaning for a two-piece suit. Pressed and hung.',
        categoryId: CATEGORIES.DRY_CLEANING.id,
        price: 14.00,
        currency: 'EUR',
        imageUrl: process.env.LAUNDRY_IMG_DRY_SUIT,
        availability: 'in stock'
      },
      {
        retailerId: 'laundry-dry-dress',
        name: 'Dry Clean – Dress or Delicate',
        description: 'Gentle dry cleaning for dresses, silk, and delicate fabrics.',
        categoryId: CATEGORIES.DRY_CLEANING.id,
        price: 10.00,
        currency: 'EUR',
        imageUrl: process.env.LAUNDRY_IMG_DRY_DRESS,
        availability: 'in stock'
      },
      // ── Ironing ───────────────────────────────────────────────────────────
      {
        retailerId: 'laundry-iron-shirt',
        name: 'Ironing – Shirt or Blouse',
        description: 'Crisp, professional pressing for one shirt or blouse.',
        categoryId: CATEGORIES.IRONING.id,
        price: 2.50,
        currency: 'EUR',
        imageUrl: process.env.LAUNDRY_IMG_IRON_SHIRT,
        availability: 'in stock'
      },
      {
        retailerId: 'laundry-iron-bundle5',
        name: 'Ironing Bundle – 5 Items',
        description: 'Get 5 garments professionally ironed at a bundled rate.',
        categoryId: CATEGORIES.IRONING.id,
        price: 10.00,
        currency: 'EUR',
        imageUrl: process.env.LAUNDRY_IMG_IRON_BUNDLE5,
        availability: 'in stock'
      },
      // ── Household Textiles ────────────────────────────────────────────────
      {
        retailerId: 'laundry-household-duvet',
        name: 'Duvet / Comforter Wash',
        description: 'Full wash and dry for single or double duvets.',
        categoryId: CATEGORIES.HOUSEHOLD.id,
        price: 12.00,
        currency: 'EUR',
        imageUrl: process.env.LAUNDRY_IMG_HOUSEHOLD_DUVET,
        availability: 'in stock'
      },
      {
        retailerId: 'laundry-household-curtains',
        name: 'Curtain Wash (per pair)',
        description: 'Machine wash and press for one pair of curtains.',
        categoryId: CATEGORIES.HOUSEHOLD.id,
        price: 9.00,
        currency: 'EUR',
        imageUrl: process.env.LAUNDRY_IMG_HOUSEHOLD_CURTAINS,
        availability: 'in stock'
      },
      // ── Promotions ────────────────────────────────────────────────────────
      {
        retailerId: 'laundry-promo-wash-iron',
        name: 'Wash + Iron Combo Deal',
        description: 'Standard machine wash for up to 5 kg, plus ironing for 5 garments — bundled price.',
        categoryId: CATEGORIES.PROMOTIONS.id,
        price: 13.00,
        currency: 'EUR',
        imageUrl: process.env.LAUNDRY_IMG_PROMO_COMBO,
        availability: 'in stock'
      }
    ]
  };
}

module.exports = { CATEGORIES, getCatalog };
