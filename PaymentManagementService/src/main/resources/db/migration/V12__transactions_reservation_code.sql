-- Carries the reservation code being redeemed (if any) from payment initiation
-- through to the outbox event, so MachineStartService can forward it to
-- MachineStateService's /api/machines/start-cycle. Null for ordinary wash payments.
ALTER TABLE transactions ADD COLUMN reservation_code VARCHAR(20);
