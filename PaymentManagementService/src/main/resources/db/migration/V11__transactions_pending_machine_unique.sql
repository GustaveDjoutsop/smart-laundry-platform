-- Prevents two concurrent PENDING transactions from being accepted for the
-- same machine (check-then-act race in PaymentService.initiatePayment).
-- A machine can have any number of non-PENDING (SUCCESSFUL/FAILED/TIMEOUT)
-- transactions, so this is a partial index, not a plain unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_machine_pending
    ON transactions (machine_id)
    WHERE status = 'PENDING';
