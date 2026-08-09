-- Email is required by Stripe's hosted checkout (see checkout_email_required
-- in afromarket.bot.json) but was never persisted anywhere - customer_profile
-- only had name/delivery_address (001_data_retention_erasure.sql), so every
-- repeat customer was asked for their email again on every single order.
-- Nullable and additive - existing rows simply get email = NULL, matching
-- the same optional-field pattern already used for name/delivery_address.
ALTER TABLE customer_profile ADD COLUMN IF NOT EXISTS email TEXT;
