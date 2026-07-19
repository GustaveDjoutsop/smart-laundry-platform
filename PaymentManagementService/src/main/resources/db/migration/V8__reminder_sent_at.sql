-- #6 (bug list): track whether an "almost-done" cycle reminder has already
-- been sent for a transaction, so CycleReminderService doesn't resend it on
-- every 60s poll while a cycle is inside its reminder window.

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMP;
