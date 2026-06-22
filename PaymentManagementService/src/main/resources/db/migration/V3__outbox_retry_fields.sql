-- P4 (architecture-review/03-MIGRATION-TODO.md): add retry-tracking columns to
-- the outbox table so the OutboxRelayService can implement exponential backoff
-- and detect dead-lettered events without a separate status column.
--
-- Dead letter convention: processed_at IS NULL AND retry_count >= 5
-- (next_retry_at is set to a far-future date so the relay stops picking it up)

ALTER TABLE outbox
    ADD COLUMN IF NOT EXISTS retry_count    INT         NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS next_retry_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS last_error     TEXT;

DROP INDEX IF EXISTS idx_outbox_unprocessed;

CREATE INDEX IF NOT EXISTS idx_outbox_pending
    ON outbox (next_retry_at)
    WHERE processed_at IS NULL;
