-- Seed test data for load-tests/k6/pay-to-start.js
--
-- Creates 10 PENDING transactions (LT-VU-1 … LT-VU-10) in payment.transactions
-- and ensures the corresponding machines (washer_01 … washer_10) exist in
-- machine.machines and are IDLE before the test runs.
--
-- Run once against dev DB before each pay-to-start.js test run:
--   psql $SPRING_DATASOURCE_URL -f load-tests/seed/pay-to-start-seed.sql
--
-- After the test, clean up:
--   DELETE FROM payment.transactions WHERE external_reference LIKE 'LT-VU-%';
--   DELETE FROM machine.machine_cycles WHERE transaction_reference LIKE 'LT-VU-%';

DO $$
DECLARE
  i INT;
  machine_id_val TEXT;
  ref_val        TEXT;
BEGIN
  FOR i IN 1..10 LOOP
    machine_id_val := 'washer_' || LPAD(i::TEXT, 2, '0');
    ref_val        := 'LT-VU-' || i;

    -- Upsert machine (MachineService.initializeMachines does this on boot,
    -- but we ensure IDLE status for the test)
    INSERT INTO machine.machines (machine_id, type, status, display_name, cycle_count, created_at, updated_at)
    VALUES (machine_id_val, 'WASHER', 'IDLE', 'Load Test Washer ' || i, 0, NOW(), NOW())
    ON CONFLICT (machine_id) DO UPDATE SET status = 'IDLE', updated_at = NOW();

    -- Delete any leftover cycle from a previous test run
    DELETE FROM machine.machine_cycles WHERE transaction_reference = ref_val;

    -- Insert a PENDING payment transaction
    INSERT INTO payment.transactions (
      external_reference, phone_number, machine_id, amount, status,
      payment_provider, cycle_duration, created_at, updated_at
    )
    VALUES (
      ref_val,
      '+237600000' || LPAD(i::TEXT, 3, '0'),
      machine_id_val,
      2000,
      'PENDING',
      'MTN',
      60,
      NOW(),
      NOW()
    )
    ON CONFLICT (external_reference) DO UPDATE
      SET status = 'PENDING', machine_id = machine_id_val, updated_at = NOW();
  END LOOP;
END $$;
