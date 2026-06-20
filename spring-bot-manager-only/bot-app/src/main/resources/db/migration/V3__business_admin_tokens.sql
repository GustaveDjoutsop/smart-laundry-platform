ALTER TABLE businesses
    ADD COLUMN IF NOT EXISTS verify_token_enc BYTEA,
    ADD COLUMN IF NOT EXISTS access_token_enc BYTEA,
    ADD COLUMN IF NOT EXISTS app_secret_enc BYTEA,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE businesses
SET updated_at = COALESCE(updated_at, created_at, NOW())
WHERE updated_at IS NULL;