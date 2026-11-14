-- Security review fixes (spec 001 T103, SEC-14, SEC-16): least privilege for request transactions.
--
-- guidesk_app (the role request handlers run as) keeps only what today's handlers need:
-- * workspace: read, and rename (owner and admin, through RLS);
-- * membership: read;
-- * onboarding_profile: read and write its own row;
-- * security_event: read through the parent table, where RLS applies;
-- * user: display fields of the caller and, for owners and admins, of the workspace's members.
-- Everything else runs in the system context (owner connection).

-- New tables get no privileges by default; each migration grants exactly what guidesk_app needs,
-- and the RLS check in CI fails if a granted table lacks forced RLS.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM guidesk_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM guidesk_app;
--> statement-breakpoint
-- System-only tables.
REVOKE ALL ON rate_limit_bucket FROM guidesk_app;
--> statement-breakpoint
-- Workspaces and memberships are created and changed only in the system context for now
-- (sign-up hook, invitation acceptance, ownership functions). Status and deletion columns stay
-- owner-only (FR-016, FR-027): admins may rename only.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON workspace FROM guidesk_app;
--> statement-breakpoint
GRANT UPDATE (name, updated_at) ON workspace TO guidesk_app;
--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON membership FROM guidesk_app;
--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON onboarding_profile FROM guidesk_app;
--> statement-breakpoint
-- Security log: events are written only in the system context, so a request cannot forge events
-- into another workspace's log. Partitions are reachable only through the parent table, because
-- the parent's RLS policies do not apply when a partition is queried directly.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON security_event FROM guidesk_app;
--> statement-breakpoint
DO $$
DECLARE
  part regclass;
BEGIN
  FOR part IN SELECT inhrelid::regclass FROM pg_inherits WHERE inhparent = 'security_event'::regclass LOOP
    EXECUTE format('REVOKE ALL ON %s FROM guidesk_app', part);
  END LOOP;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION security_event_create_partition(month_start date) RETURNS void
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  from_date date := date_trunc('month', month_start)::date;
  to_date date := (date_trunc('month', month_start) + interval '1 month')::date;
  partition_name text := format('security_event_y%sm%s', to_char(from_date, 'YYYY'), to_char(from_date, 'MM'));
BEGIN
  IF to_regclass(partition_name) IS NULL THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF security_event FOR VALUES FROM (%L) TO (%L)',
      partition_name, from_date, to_date
    );
    EXECUTE format('REVOKE ALL ON %I FROM guidesk_app', partition_name);
  END IF;
END
$$;
--> statement-breakpoint
-- Pseudonymization during account purge (FR-028) may only blank the actor or replace it with a
-- "deleted:" pseudonym; it can never re-attribute events to another user.
CREATE OR REPLACE FUNCTION security_event_reject_changes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('app.security_event_pseudonymize', true) = 'on'
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id')
     AND OLD.actor_user_id IS NOT NULL
     AND OLD.actor_user_id NOT LIKE 'deleted:%'
     AND (NEW.actor_user_id IS NULL OR NEW.actor_user_id LIKE 'deleted:%') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'security_event is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
-- With FORCE ROW LEVEL SECURITY, the owner needs an explicit policy for pseudonymization; the
-- trigger above still rejects every other change.
CREATE POLICY security_event_system_pseudonymize ON security_event FOR UPDATE TO CURRENT_USER
  USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Likewise for DELETE, so an attempted delete fails loudly in the trigger instead of matching
-- no rows. Retention drops whole partitions (DDL); rows are never deleted.
CREATE POLICY security_event_system_delete ON security_event FOR DELETE TO CURRENT_USER
  USING (true);
--> statement-breakpoint
-- The owner invariant must see every row, whatever the caller's RLS context.
CREATE OR REPLACE FUNCTION membership_require_owner() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
DECLARE
  affected uuid := COALESCE(OLD.workspace_id, NEW.workspace_id);
BEGIN
  IF EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = affected)
     AND NOT EXISTS (SELECT 1 FROM public.membership m WHERE m.workspace_id = affected AND m.role = 'owner') THEN
    RAISE EXCEPTION 'workspace % must keep exactly one owner', affected USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION membership_require_owner() FROM PUBLIC;
--> statement-breakpoint
-- user: a request sees its own display fields and, for owners and admins, those of the current
-- workspace's members (member lists, US4). The auth library uses the owner connection.
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "user" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY user_system ON "user" FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY user_read ON "user" FOR SELECT TO guidesk_app
  USING (
    id = app_current_user_id()
    OR (
      app_current_workspace_role() IN ('owner', 'admin')
      AND EXISTS (
        SELECT 1 FROM membership m
        WHERE m.user_id = "user".id AND m.workspace_id = app_current_workspace_id()
      )
    )
  );
