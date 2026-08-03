-- Locks out Supabase's anon/authenticated PostgREST access to these tables.
-- BotManagerService connects via a direct Postgres connection string (the
-- `postgres` role, which bypasses RLS), so this only affects the
-- client-side Supabase API path, which this project doesn't use.
ALTER TABLE public.customer_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deletion_request_log ENABLE ROW LEVEL SECURITY;
