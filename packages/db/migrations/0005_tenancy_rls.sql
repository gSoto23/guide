-- Row-level security for tenancy (spec 001 research R4, SEC-14, AC-SEC-004).
--
-- Two contexts:
-- * Request context: handlers run as guidesk_app (SET LOCAL ROLE). Policies below "TO guidesk_app"
--   limit them to the signed-in user's memberships and role.
-- * System context: the owner connection (auth hooks, SECURITY DEFINER functions, worker jobs).
--   Explicit "system" policies grant it full access, so FORCE ROW LEVEL SECURITY documents the
--   intent instead of silently exempting the owner.

-- The caller's role in the current workspace, computed by withRlsContext from the caller's own
-- membership row (the database derives it from data; it is not taken from the request).
CREATE OR REPLACE FUNCTION app_current_workspace_role() RETURNS text
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.workspace_role', true), '') $$;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_workspace_role() TO guidesk_app;
--> statement-breakpoint
ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspace FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE membership ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE membership FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE onboarding_profile ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE onboarding_profile FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- System context (owner connection).
CREATE POLICY workspace_system ON workspace FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY membership_system ON membership FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY onboarding_profile_system ON onboarding_profile FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY security_event_system_read ON security_event FOR SELECT TO CURRENT_USER USING (true);
--> statement-breakpoint
-- Request context: memberships. A user sees their own memberships; owners and admins see every
-- membership of the current workspace (FR-016).
CREATE POLICY membership_read ON membership FOR SELECT TO guidesk_app
  USING (
    user_id = app_current_user_id()
    OR (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  );
--> statement-breakpoint
-- Request context: workspaces the user belongs to. Active workspaces for every member; a workspace
-- pending deletion only for its owner (FR-027).
CREATE POLICY workspace_read ON workspace FOR SELECT TO guidesk_app
  USING (
    EXISTS (
      SELECT 1 FROM membership m
      WHERE m.workspace_id = workspace.id
        AND m.user_id = app_current_user_id()
        AND (workspace.status = 'active' OR m.role = 'owner')
    )
  );
--> statement-breakpoint
CREATE POLICY workspace_update ON workspace FOR UPDATE TO guidesk_app
  USING (id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
-- Workspaces and memberships are created only in the system context (sign-up hook, invitation
-- acceptance, and create-workspace functions), never directly by request handlers.
--
-- Request context: onboarding answers belong to their user.
CREATE POLICY onboarding_profile_own ON onboarding_profile FOR ALL TO guidesk_app
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());
--> statement-breakpoint
-- Workspace security log for owners and admins of the current workspace (FR-030).
CREATE POLICY security_event_read_workspace ON security_event FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
-- No transaction may leave a workspace without an owner (data model §3). Deferred, so ownership
-- transfer can swap roles inside one transaction.
CREATE OR REPLACE FUNCTION membership_require_owner() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  affected uuid := COALESCE(OLD.workspace_id, NEW.workspace_id);
BEGIN
  IF EXISTS (SELECT 1 FROM workspace w WHERE w.id = affected)
     AND NOT EXISTS (SELECT 1 FROM membership m WHERE m.workspace_id = affected AND m.role = 'owner') THEN
    RAISE EXCEPTION 'workspace % must keep exactly one owner', affected USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER membership_keep_owner
  AFTER UPDATE OR DELETE ON membership
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION membership_require_owner();
