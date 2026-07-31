-- idempotency_keys (V2) was created as prep for this and never wired into application
-- code (see V2's comment). Wiring it up (architecture-review 06-PAYMENT-GATEWAY-DESIGN-
-- REVIEW.md) requires a link from the key to the transaction it produced, so a retried
-- request can return that transaction's current state instead of just being rejected.
-- Table is confirmed empty in every environment (zero app code has ever written to it),
-- so NOT NULL with no default is safe here.
ALTER TABLE idempotency_keys
    ADD COLUMN external_reference VARCHAR(50) NOT NULL
        REFERENCES transactions(external_reference);
