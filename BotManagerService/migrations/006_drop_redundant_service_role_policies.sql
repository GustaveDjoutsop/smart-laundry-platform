-- Removes four `service_role_full_access` policies that exist in the live
-- database but in no migration - they were added through the Supabase
-- dashboard, which is why migration 002's comment (RLS on, deliberately
-- zero policies) no longer matched reality.
--
-- Each was `FOR ALL TO service_role USING (true) WITH CHECK (true)`. They
-- granted nothing: `service_role` has rolbypassrls = true (verified on the
-- live project), so RLS is not evaluated for it at all, with or without a
-- policy. Nothing in this service uses the service_role key or the
-- PostgREST API either - the bot connects as `postgres` over a direct
-- Postgres connection (src/core/db/pgClient.js).
--
-- Dropping them restores the single intended shape: RLS enabled, no
-- policies, so the anon/authenticated Supabase API path stays locked out
-- and the file tree is the truth about what is enabled. The `orders`
-- table added by the pending orders-status PR is absent below because it
-- never had such a policy; it enables RLS in its own migration.
DROP POLICY IF EXISTS service_role_full_access ON public.customer_profile;
DROP POLICY IF EXISTS service_role_full_access ON public.invoice_record;
DROP POLICY IF EXISTS service_role_full_access ON public.deletion_request_log;
DROP POLICY IF EXISTS service_role_full_access ON public.customer_identity_link;

-- Re-assert the intended end state instead of trusting it. All four are
-- idempotent, and they close a real gap rather than restating migration
-- 002: that migration enables RLS on three tables only, and
-- customer_identity_link (migration 004) was never given RLS by any
-- migration - only through the dashboard, the same untracked drift this
-- file exists to clean up.
--
-- This matters on any database rebuilt from this migration tree (restore
-- drill, a new smartlaundry-prod project, a local reproduction):
-- customer_identity_link would come up with RLS off, and anon/
-- authenticated hold Supabase's default public-schema privileges
-- (SELECT/INSERT/UPDATE/DELETE) on it. RLS is the only control in front
-- of them, so with it off the phone-to-BSUID linkage table - canonical
-- customer_id plus raw phone numbers - would be readable and writable
-- over the REST API with the publishable anon key. The write side is the
-- worse half: forged link_method = 'manual_admin' rows could attach one
-- person's phone to another customer_id, exactly the inference-based
-- linkage afromarket-identity-linkage-design.md rules out.
ALTER TABLE public.customer_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_request_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_identity_link ENABLE ROW LEVEL SECURITY;
