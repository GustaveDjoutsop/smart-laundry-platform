-- Marks a transaction as a reservation-hold FEE payment (paid to confirm a future
-- slot) rather than a payment that should start a machine right now. Without this
-- flag, processWebhook could not tell the two apart and dispatched a real
-- start-cycle call the moment a reservation fee cleared.
ALTER TABLE transactions ADD COLUMN reservation_hold BOOLEAN NOT NULL DEFAULT FALSE;
