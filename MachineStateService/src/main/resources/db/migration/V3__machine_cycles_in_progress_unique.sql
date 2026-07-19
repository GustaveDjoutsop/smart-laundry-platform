-- Prevents two concurrent startCycle calls from both creating an IN_PROGRESS
-- cycle for the same machine (check-then-act race in MachineService.startCycle).
-- A machine can have any number of NOT_STARTED/COMPLETED cycles, so this is a
-- partial index, not a plain unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_machine_cycles_machine_in_progress
    ON machine_cycles (machine_id)
    WHERE status = 'IN_PROGRESS';
