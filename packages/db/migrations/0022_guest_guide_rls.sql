-- Row-level security, grants, and the stay check for feature 004 (data model §1–§4, T012, SEC-14).
--
-- Same two contexts as features 001 to 003:
-- * Request context (guidesk_app): members read property links and open counts; owners and admins
--   read stay links and guest sessions (the Share screen) and write links while the workspace is
--   active. Agents see no stay links or sessions (FR-044, AC-SEC-008).
-- * System context (the owner connection): guest routes after resolving a link (research R12), the
--   share service when it decrypts a token or code, and retention.
--
-- Token and code ciphertexts are never selectable by guidesk_app (SEC-06).
--> statement-breakpoint
ALTER TABLE guide_link ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_link FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stay_link ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stay_link FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_session ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_session FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_open_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_open_daily FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- 1. System context.
--> statement-breakpoint
CREATE POLICY guide_link_system ON guide_link FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY stay_link_system ON stay_link FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY guide_session_system ON guide_session FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY guide_open_daily_system ON guide_open_daily FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
-- 2. Property links: members read; owners and admins create and replace (app_can_write_guides,
-- migration 0019: owners and admins of the request's workspace while it is active).
--> statement-breakpoint
CREATE POLICY guide_link_read ON guide_link FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY guide_link_insert ON guide_link FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_link_update ON guide_link FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON guide_link TO guidesk_app;
--> statement-breakpoint
-- 3. Stay links: owners and admins only, without the ciphertext columns.
--> statement-breakpoint
CREATE POLICY stay_link_read ON stay_link FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
CREATE POLICY stay_link_update ON stay_link FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT (
  id, workspace_id, property_id, stay_id, status, created_by, created_at, last_copied_at,
  last_copied_by, ended_at, ended_by, failure_count, failure_window_started_at, locked_until,
  lockout_count, last_lockout_at
) ON stay_link TO guidesk_app;
--> statement-breakpoint
-- Revoking and the copy timestamp are request-context updates; creating a link (which writes the
-- ciphertexts) happens in the system context after the request-context checks.
GRANT UPDATE (status, ended_at, ended_by, last_copied_at, last_copied_by) ON stay_link TO guidesk_app;
--> statement-breakpoint
-- 4. Guest sessions: owners and admins read (device counts). Writes only in the system context.
--> statement-breakpoint
CREATE POLICY guide_session_read ON guide_session FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT (id, workspace_id, property_id, stay_link_id, verified_at, created_at, last_seen_at)
  ON guide_session TO guidesk_app;
--> statement-breakpoint
-- 5. Open counts: members read. Writes only in the system context.
--> statement-breakpoint
CREATE POLICY guide_open_daily_read ON guide_open_daily FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
GRANT SELECT ON guide_open_daily TO guidesk_app;
--> statement-breakpoint
-- 6. A stay link belongs to its stay's workspace and property (data model §1).
--> statement-breakpoint
CREATE OR REPLACE FUNCTION stay_link_matches_stay() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.stay s
      WHERE s.id = NEW.stay_id AND s.workspace_id = NEW.workspace_id AND s.property_id = NEW.property_id
    ) THEN
      RAISE EXCEPTION 'stay_link does not match its stay' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;
--> statement-breakpoint
CREATE TRIGGER stay_link_matches_stay
  BEFORE INSERT OR UPDATE OF stay_id, workspace_id, property_id ON stay_link
  FOR EACH ROW EXECUTE FUNCTION stay_link_matches_stay();
--> statement-breakpoint
-- 7. A guest session belongs to its stay link's workspace and property.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guide_session_matches_link() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.stay_link l
      WHERE l.id = NEW.stay_link_id AND l.workspace_id = NEW.workspace_id AND l.property_id = NEW.property_id
    ) THEN
      RAISE EXCEPTION 'guide_session does not match its stay link' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;
--> statement-breakpoint
CREATE TRIGGER guide_session_matches_link
  BEFORE INSERT OR UPDATE OF stay_link_id, workspace_id, property_id ON guide_session
  FOR EACH ROW EXECUTE FUNCTION guide_session_matches_link();
