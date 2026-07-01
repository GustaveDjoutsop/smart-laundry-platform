-- V3 (outbox_retry_fields) was modified in source after being applied to the DB.
-- The schema changes themselves are correct and already present. This corrects
-- the stale checksum in flyway_schema_history so validation can be re-enabled.
UPDATE payment.flyway_schema_history
SET checksum = 1327994462
WHERE version = '3';
