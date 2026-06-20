-- P4 (architecture-review/03-MIGRATION-TODO.md): idempotency guard for the
-- outbox relay. When the relay dispatches a PaymentSucceeded event it calls
-- POST /api/machines/start-cycle with a transactionReference. A partial unique
-- index on that column (NULL rows excluded — RFID/manual starts have no tx ref)
-- ensures two concurrent relay deliveries of the same event cannot both create
-- a cycle row, so MachineService.startCycle() can return the existing cycle
-- on a duplicate without any extra idempotency table.

CREATE UNIQUE INDEX idx_machine_cycles_tx_ref
    ON machine_cycles (transaction_reference)
    WHERE transaction_reference IS NOT NULL;
