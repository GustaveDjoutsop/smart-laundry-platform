# Smart Laundry WhatsApp Catalog & Promotion Setup

This document explains how to configure and operate Smart Laundry's WhatsApp
catalog integration and marketing template pipeline. These are distinct
concerns that must be managed separately:

| Concern | What it is | Where it lives |
|---------|-----------|----------------|
| **Catalog data** | Services listed in a Meta Commerce Catalog | `config/laundryCatalog.js` |
| **WhatsApp templates** | Approved message templates for outbound blasts | `config/laundryTemplates.js` |
| **Order handling** | Bot conversation flows and payment | `src/bots/laundry/` |

Submitting a template does **not** create or populate a Meta catalog, and vice
versa. The catalog and the templates are configured independently in Meta
Business Manager.

---

## Required environment variables

Copy `.env.example` (if present) or create a `.env` file at the
`BotManagerService/` root. **Never commit this file.**

### Catalog sync (`submitLaundryCatalogBatch.js`)

| Variable | Description |
|----------|-------------|
| `WHATSAPP_ACCESS_TOKEN_LAUNDRY` | Graph API token with `catalog_management` permission on the laundry WABA. |
| `LAUNDRY_CATALOG_ID` | Meta Commerce Catalog ID. Find it in [Commerce Manager](https://business.facebook.com/commerce/catalogs) or via `GET /{WABA_ID}/product_catalogs`. **No default** — must be set explicitly. |
| `LAUNDRY_PHONE_NUMBER` | Laundry bot phone number in E.164 format without `+` (e.g. `4915123456789`). Used to build `wa.me` deep links for each service. |

### Product images (one per service)

Each image must be hosted at a publicly accessible HTTPS URL. Set these
variables to that URL before running a catalog sync. Missing variables are
caught by validation before any Meta API call.

| Variable | Service |
|----------|---------|
| `LAUNDRY_IMG_WASH_STANDARD` | Standard Machine Wash |
| `LAUNDRY_IMG_WASH_EXPRESS` | Express Machine Wash |
| `LAUNDRY_IMG_WASH_LARGE` | Large Load Machine Wash |
| `LAUNDRY_IMG_DRY_SUIT` | Dry Clean – Suit |
| `LAUNDRY_IMG_DRY_DRESS` | Dry Clean – Dress or Delicate |
| `LAUNDRY_IMG_IRON_SHIRT` | Ironing – Shirt or Blouse |
| `LAUNDRY_IMG_IRON_BUNDLE5` | Ironing Bundle – 5 Items |
| `LAUNDRY_IMG_HOUSEHOLD_DUVET` | Duvet / Comforter Wash |
| `LAUNDRY_IMG_HOUSEHOLD_CURTAINS` | Curtain Wash |
| `LAUNDRY_IMG_PROMO_COMBO` | Wash + Iron Combo Deal |

### Template submission (`submitLaundryTemplates.js`)

| Variable | Description |
|----------|-------------|
| `WHATSAPP_ACCESS_TOKEN_LAUNDRY` | Same token as above, needs `whatsapp_business_management` scope. |
| `LAUNDRY_WABA_ID` | Laundry WABA ID. Find it in Meta Business Manager > WhatsApp Accounts. |

---

## Image hosting

Meta requires all catalog product images and template header images to be
served from a **publicly accessible HTTPS URL**. Options:

- Upload images to an object storage bucket (S3, Google Cloud Storage,
  Cloudflare R2) and set the public URL in the corresponding env variable.
- Use your CDN or a static hosting service (Vercel, Netlify, etc.).
- Do **not** use local file paths or private URLs — Meta will fail to fetch
  them during catalog processing.

Images for catalog items (set via `LAUNDRY_IMG_*`) are embedded as
`image_link` in the batch payload. Images for template headers are uploaded
to the Graph API at submission time (the script reads the file from disk and
uploads it via the `/uploads` session endpoint, then embeds the returned
handle in the template payload).

---

## Meta catalog configuration (manual — done once in Business Manager)

Before running the catalog sync script for the first time:

1. Create a Commerce Catalog in [Meta Commerce Manager](https://business.facebook.com/commerce/catalogs)
   linked to the laundry WABA.
2. Note the **Catalog ID** and set it as `LAUNDRY_CATALOG_ID`.
3. (Optional) Connect the catalog to your WhatsApp Business Account to enable
   native catalog browsing in the bot.

The catalog sync script (`submitLaundryCatalogBatch.js`) maintains the
product data inside that catalog. It does **not** create the catalog itself.

---

## Running the catalog sync

```bash
# Validate and sync all services to the Meta catalog
node scripts/submitLaundryCatalogBatch.js
```

The script:
1. Validates all products (including image URL presence) before sending
   anything to Meta.
2. Submits a batch `UPDATE` with `allow_upsert=true` — safe to rerun.
3. Prints a sync summary.

**Note on per-item results:** The Meta Catalog Batch API processes requests
asynchronously. A `200` response means the batch was accepted, not that
every item succeeded. Check Commerce Manager's catalog diagnostics for
per-item status after a sync.

**Note on deletions:** The script never deletes items. If you remove a
service from `config/laundryCatalog.js` or change its `retailerId`, the old
entry remains as a stale item in the Meta catalog. Remove it manually in
Commerce Manager or extend the script to diff live catalog IDs against config
IDs and issue `DELETE` requests for the difference.

---

## Running template submission

```bash
# Submit the welcome/promo template (requires a JPEG header image)
node scripts/submitLaundryTemplates.js WELCOME_PROMO /path/to/laundry-header.jpg

# Submit the weekly promo template
node scripts/submitLaundryTemplates.js WEEKLY_PROMO /path/to/laundry-promo.jpg

# Submit both at once (same header image for both)
node scripts/submitLaundryTemplates.js ALL /path/to/laundry-header.jpg
```

After submission, templates enter a review queue. Check their status with:

```bash
node scripts/checkTemplateStatus.js laundry_welcome_promo
node scripts/checkTemplateStatus.js laundry_weekly_promo
```

Templates approved on the **sandbox WABA** are invisible to the **production
WABA** and vice versa. Submit to both environments if needed.

---

## Template overview

| Template name | Category | Variables | When to use |
|---------------|----------|-----------|-------------|
| `laundry_welcome_promo` | MARKETING | none | Sent when a customer opens the catalog or starts a session for the first time. |
| `laundry_weekly_promo` | MARKETING | `{{1}}` = discount %, `{{2}}` = service name | Weekly promotional blast. Vary the featured service and discount at send time without resubmitting. |

---

## Running tests

The validation module has a full unit test suite:

```bash
node --test test/laundryCatalogValidation.test.js
```

Or run the full test suite:

```bash
npm test
```

---

## Adding or changing services

1. Edit `config/laundryCatalog.js` — add/remove/update entries in the
   `products` array. Every product needs a stable, unique `retailerId`.
2. Add the corresponding `LAUNDRY_IMG_*` environment variable for any new
   image.
3. Rerun `node scripts/submitLaundryCatalogBatch.js` to sync.
4. Update Commerce Manager manually if you changed or removed `retailerId`
   values (see the note on deletions above).
