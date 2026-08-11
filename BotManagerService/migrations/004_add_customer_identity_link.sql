-- Links a customer's phone number and BSUID (Business-Scoped User ID) under
-- one canonical customer_id, so the erasure flow (ADR-008 open question #4)
-- and future order-history lookups can resolve either identifier back to
-- the same real person once WhatsApp usernames roll out. See
-- afromarket-identity-linkage-design.md for the full design and why linkage
-- only ever happens via Meta-verified pairing or explicit customer
-- confirmation - never inferred from name/address/order similarity.
--
-- Additive: customer_profile.customer_id is nullable and existing rows are
-- left unlinked until they're next touched by the resolver. No backfill -
-- there's no orders table yet to backfill against (see the design doc's
-- Open Items), and customer_profile rows are cheap to re-link the next time
-- that customer messages in.
CREATE TABLE IF NOT EXISTS customer_identity_link (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL,
  identifier_type TEXT NOT NULL CHECK (identifier_type IN ('phone', 'bsuid')),
  identifier_value TEXT NOT NULL,
  link_method TEXT NOT NULL CHECK (link_method IN ('meta_contact_book', 'request_contact_info_confirmed', 'manual_admin')),
  linked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (identifier_type, identifier_value)
);

CREATE INDEX IF NOT EXISTS customer_identity_link_customer_id_idx ON customer_identity_link (customer_id);

ALTER TABLE customer_profile ADD COLUMN IF NOT EXISTS customer_id UUID;
