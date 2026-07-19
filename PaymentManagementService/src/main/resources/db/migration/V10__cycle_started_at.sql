-- #7 (bug list, PR A follow-up): CycleReminderService and CycleCompletionService
-- both need an immutable cycle-start anchor. They previously used updated_at,
-- but @PreUpdate refreshes updated_at on every save of the row — including the
-- reminder/completion jobs' own bookkeeping saves (reminder_sent_at,
-- completed_notified_at) — silently pushing the computed cycleEnd forward and
-- delaying (or losing) the completion notification. cycle_started_at is set
-- once, when a payment first succeeds, and never touched again.

ALTER TABLE transactions
    ADD COLUMN IF NOT EXISTS cycle_started_at TIMESTAMP;
