-- Roles and RLS helpers (spec 001 research R4, SEC-14).
-- Requests run as guidesk_app (SET LOCAL ROLE in withRlsContext), a role without BYPASSRLS that
-- owns no tables, so row-level security always applies. Migrations run as the database owner.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'guidesk_app') THEN
    CREATE ROLE guidesk_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
  END IF;
END
$$;
--> statement-breakpoint
-- The connecting (owner) user must be able to switch to guidesk_app.
GRANT guidesk_app TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO guidesk_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO guidesk_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO guidesk_app;
--> statement-breakpoint
-- Current request context, set with set_config(..., true) per transaction.
CREATE OR REPLACE FUNCTION app_current_user_id() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '') $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_current_workspace_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_user_id() TO guidesk_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_workspace_id() TO guidesk_app;
