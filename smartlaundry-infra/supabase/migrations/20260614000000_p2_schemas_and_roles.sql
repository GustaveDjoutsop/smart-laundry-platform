-- Phase 2 (architecture-review/03-MIGRATION-TODO.md): provision schema-per-service
-- layout and least-privilege roles on the consolidated Supabase project.
--
-- Each service gets its own schema and its own login role, granted only on
-- that schema. Role passwords are NOT set here (left unusable until rotated
-- via a separate, non-committed ALTER ROLE) so no secret ever lands in git.

-- ---------------------------------------------------------------------------
-- Schemas
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS bot;
CREATE SCHEMA IF NOT EXISTS payment;
CREATE SCHEMA IF NOT EXISTS machine;
CREATE SCHEMA IF NOT EXISTS ops;

-- ---------------------------------------------------------------------------
-- Roles (created with LOGIN but no password — password set out-of-band)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bot_svc') THEN
    CREATE ROLE bot_svc LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'payment_svc') THEN
    CREATE ROLE payment_svc LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'machine_svc') THEN
    CREATE ROLE machine_svc LOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ops_svc') THEN
    CREATE ROLE ops_svc LOGIN;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Per-schema grants: each role gets full control of its own schema only.
-- ---------------------------------------------------------------------------

-- bot / bot_svc
GRANT USAGE, CREATE ON SCHEMA bot TO bot_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA bot TO bot_svc;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA bot TO bot_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA bot GRANT ALL ON TABLES TO bot_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA bot GRANT ALL ON SEQUENCES TO bot_svc;
ALTER ROLE bot_svc SET search_path = bot;

-- payment / payment_svc
GRANT USAGE, CREATE ON SCHEMA payment TO payment_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA payment TO payment_svc;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA payment TO payment_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA payment GRANT ALL ON TABLES TO payment_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA payment GRANT ALL ON SEQUENCES TO payment_svc;
ALTER ROLE payment_svc SET search_path = payment;

-- machine / machine_svc
GRANT USAGE, CREATE ON SCHEMA machine TO machine_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA machine TO machine_svc;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA machine TO machine_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA machine GRANT ALL ON TABLES TO machine_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA machine GRANT ALL ON SEQUENCES TO machine_svc;
ALTER ROLE machine_svc SET search_path = machine;

-- ops / ops_svc (reserved for Phase 5 OperationsService)
GRANT USAGE, CREATE ON SCHEMA ops TO ops_svc;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ops TO ops_svc;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ops TO ops_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT ALL ON TABLES TO ops_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA ops GRANT ALL ON SEQUENCES TO ops_svc;
ALTER ROLE ops_svc SET search_path = ops;

-- ---------------------------------------------------------------------------
-- Cross-schema isolation: no role can see another service's schema.
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA bot FROM PUBLIC;
REVOKE ALL ON SCHEMA payment FROM PUBLIC;
REVOKE ALL ON SCHEMA machine FROM PUBLIC;
REVOKE ALL ON SCHEMA ops FROM PUBLIC;
