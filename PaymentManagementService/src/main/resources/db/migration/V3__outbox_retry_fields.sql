-- P4 (architecture-review/03-MIGRATION-TODO.md): add retry-tracking columns to
-- the outbox table so the OutboxRelayService can implement exponential backoff
-- and detect dead-lettered events without a separate status column.
--
-- Dead letter convention: processed_at IS NULL AND retry_count >= 5
-- (next_retry_at is set to a far-future date so the relay stops picking it up)

ALTER TABLE outbox
    ADD COLUMN retry_count    INT         NOT NULL DEFAULT 0,
    ADD COLUMN next_retry_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN last_error     TEXT;

-- Replace the old partial index with one that also filters on next_retry_at
-- for the polling query: WHERE processed_at IS NULL AND next_retry_at <= now()
DROP INDEX IF EXISTS idx_outbox_unprocessed;

CREATE INDEX idx_outbox_pending
    ON outbox (next_retry_at)
    WHERE processed_at IS NULL;
