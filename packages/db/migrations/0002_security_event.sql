-- Append-only security log (spec 001 FR-030, research R11, SEC-16).
-- Partitioned by month. guidesk_app may INSERT and SELECT only, and a trigger rejects UPDATE and
-- DELETE for everyone, except actor pseudonymization during account purge (FR-028).
CREATE TABLE security_event (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  type text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure', 'denied')),
  actor_user_id text,
  workspace_id uuid,
  target_type text,
  target_id text,
  ip_hash text,
  approx_location text,
  user_agent_family text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);
--> statement-breakpoint
CREATE TABLE security_event_default PARTITION OF security_event DEFAULT;
--> statement-breakpoint
CREATE INDEX security_event_workspace_idx ON security_event (workspace_id, occurred_at DESC);
--> statement-breakpoint
CREATE INDEX security_event_actor_idx ON security_event (actor_user_id, occurred_at DESC);
--> statement-breakpoint
-- Creates the partition for the month that contains month_start. The worker calls it ahead of
-- each month; old partitions are dropped by the retention job (24 months, pending OQ-35).
CREATE OR REPLACE FUNCTION security_event_create_partition(month_start date) RETURNS void
  LANGUAGE plpgsql
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
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM guidesk_app', partition_name);
  END IF;
END
$$;
--> statement-breakpoint
SELECT security_event_create_partition(current_date);
--> statement-breakpoint
SELECT security_event_create_partition((current_date + interval '1 month')::date);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION security_event_reject_changes() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('app.security_event_pseudonymize', true) = 'on'
     AND (to_jsonb(NEW) - 'actor_user_id') = (to_jsonb(OLD) - 'actor_user_id') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'security_event is append-only (% rejected)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END
$$;
--> statement-breakpoint
CREATE TRIGGER security_event_append_only
  BEFORE UPDATE OR DELETE ON security_event
  FOR EACH ROW EXECUTE FUNCTION security_event_reject_changes();
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON security_event FROM guidesk_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON security_event_default FROM guidesk_app;
--> statement-breakpoint
ALTER TABLE security_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE security_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Any role may append events. Workspace-level read policies arrive with the membership table
-- (spec 001, US1/US3); until then users read only their own account-level events.
CREATE POLICY security_event_insert ON security_event FOR INSERT WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY security_event_read_own ON security_event FOR SELECT
  USING (workspace_id IS NULL AND actor_user_id = app_current_user_id());
