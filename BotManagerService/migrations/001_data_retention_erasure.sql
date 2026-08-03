-- ADR-008: Data Retention & Right-to-Erasure Architecture
-- Splits personal data (freely erasable) from fiscal/invoice data (must
-- survive 10 years per § 147 AO / § 257 HGB) into two separate stores.

CREATE TABLE IF NOT EXISTS customer_profile (
  bot_id            TEXT        NOT NULL,
  whatsapp_id       TEXT        NOT NULL,
  name              TEXT,
  delivery_address  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_active_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bot_id, whatsapp_id)
);

CREATE INDEX IF NOT EXISTS idx_customer_profile_last_active_at
  ON customer_profile (last_active_at);

CREATE TABLE IF NOT EXISTS invoice_record (
  id                BIGSERIAL   PRIMARY KEY,
  invoice_number    TEXT        NOT NULL UNIQUE,
  bot_id            TEXT        NOT NULL,
  transaction_id    TEXT        NOT NULL,
  provider          TEXT        NOT NULL,
  buyer_name        TEXT,
  buyer_address     TEXT,
  buyer_phone       TEXT,
  line_items        JSONB       NOT NULL DEFAULT '[]'::jsonb,
  amount            NUMERIC(12, 2) NOT NULL,
  currency          TEXT        NOT NULL,
  tax_status        TEXT,
  payment_reference TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Fixed 10-year retention (§ 147 AO / § 257 HGB), set once at insert time
  -- (created_at + interval '10 years'). Not a GENERATED column: Postgres
  -- rejects timestamptz + interval as a generation expression because
  -- calendar/DST math isn't considered immutable - fine as a plain INSERT
  -- expression, just not as a STORED generated column.
  retain_until      TIMESTAMPTZ NOT NULL,
  UNIQUE (bot_id, transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_record_retain_until
  ON invoice_record (retain_until);

-- Belt-and-braces enforcement of "append-only": block UPDATE entirely, and
-- block DELETE unless the row is actually past its retention deadline. This
-- means the app-level retention job's DELETE is the only DELETE that can
-- ever succeed against this table.
CREATE OR REPLACE FUNCTION invoice_record_prevent_early_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'invoice_record rows are immutable (append-only)';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.retain_until > now() THEN
    RAISE EXCEPTION 'invoice_record row % cannot be deleted before retain_until (%)', OLD.id, OLD.retain_until;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_invoice_record_immutable ON invoice_record;
CREATE TRIGGER trg_invoice_record_immutable
  BEFORE UPDATE OR DELETE ON invoice_record
  FOR EACH ROW EXECUTE FUNCTION invoice_record_prevent_early_mutation();

-- Accountability trail for erasure requests (Art. 5(2) DSGVO).
CREATE TABLE IF NOT EXISTS deletion_request_log (
  id            BIGSERIAL   PRIMARY KEY,
  bot_id        TEXT        NOT NULL,
  whatsapp_id   TEXT        NOT NULL,
  requested_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  status        TEXT        NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_deletion_request_log_whatsapp_id
  ON deletion_request_log (bot_id, whatsapp_id);
