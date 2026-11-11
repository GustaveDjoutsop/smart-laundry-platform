-- Fulfilment status for AfroMarket orders (CONFIRMED -> SHIPPED ->
-- DELIVERED), split out of invoice_record because that table is legally
-- write-once: migration 001 installs a trigger that rejects every UPDATE
-- and DELETE before retain_until (10 years, § 147 AO / § 257 HGB), so a
-- mutable status column cannot live there. See
-- docs/requirements/afromarket-delivery-notifications-todo.md.
--
-- order_number is invoice_record.invoice_number (InvoiceRecordStore builds
-- it as `<BOT_ID>-<transactionId>`, e.g. AFROMARKET-32V17699T05397320), so
-- there is exactly one status row per invoice and no second identifier to
-- keep in sync.
--
-- ON DELETE CASCADE is required, not cosmetic: the retention worker
-- (src/core/retention/retentionWorker.js) deletes invoices once
-- retain_until passes, and a RESTRICT/NO ACTION reference here would block
-- that delete and silently break retention.
--
-- No personal-data column (no customer_phone/name/address) on purpose:
-- under ADR-008 personal data lives in customer_profile, which the erasure
-- flow can delete. A phone number copied in here would be erased by
-- neither the erasure service nor the retention worker. The customer's
-- phone is reachable by joining invoice_record on invoice_number.
CREATE TABLE IF NOT EXISTS orders (
  order_number TEXT PRIMARY KEY REFERENCES invoice_record (invoice_number) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED', 'SHIPPED', 'DELIVERED')),
  confirmed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  -- Status and its timestamp move together. Until the admin intercept
  -- exists, status is changed by hand in the Supabase Table Editor, and a
  -- hand edit to 'DELIVERED' that leaves delivered_at null would quietly
  -- break every later "delivered in the last N days" query. Cheap to add
  -- now, awkward once the table has history.
  CONSTRAINT orders_shipped_at_set CHECK (status <> 'SHIPPED' OR shipped_at IS NOT NULL),
  CONSTRAINT orders_delivered_at_set CHECK (status <> 'DELIVERED' OR delivered_at IS NOT NULL)
);

-- Same deliberate no-policy shape as migration 002: RLS on, zero policies.
-- The bot connects as `postgres` (bypasses RLS); the public Supabase
-- anon/authenticated API path is unused by this project and stays locked out.
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

-- Backfill: give every invoice already on file a CONFIRMED status row, so
-- the existing 19 orders (counted against the live botmanagerservice
-- project on 2026-11-11) show up on the fulfilment board instead of only
-- orders placed after this migration. INSERT ... SELECT rather than
-- literals so the count can't drift between writing and applying this.
-- Delete this statement before applying if only new orders matter.
--
-- Scoped to bot_id = 'afromarket': invoice_record is bot-generic (the
-- laundry side is on the roadmap) while this is AfroMarket's fulfilment
-- board, so an unfiltered backfill would put another bot's first invoice
-- on it.
INSERT INTO orders (order_number, status, confirmed_at)
SELECT invoice_record.invoice_number, 'CONFIRMED', invoice_record.created_at
FROM invoice_record
WHERE invoice_record.bot_id = 'afromarket'
ON CONFLICT (order_number) DO NOTHING;
