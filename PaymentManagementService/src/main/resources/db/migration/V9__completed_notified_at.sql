-- #7 (bug list, PR A): track whether a "cycle completed" proactive WhatsApp
-- notification has already been sent for a transaction, so
-- CycleCompletionService doesn't resend it on every 60s poll.

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS completed_notified_at TIMESTAMP;
