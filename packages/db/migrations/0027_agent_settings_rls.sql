-- Row-level security and grants for feature 007 (data model, T008, SEC-14).
--
-- * Request context (guidesk_app): every member reads the assistant settings, contacts, instruction
--   versions, and tests of the request's workspace. Owners and admins write settings, contacts, and
--   instruction versions while the workspace is active (FR-015). Members who handle conversations
--   create tests as themselves (FR-018).
-- * System context (the owner connection): the `chat.reply`, `assistant.test`, and
--   `chat.quiet-digest` jobs, and retention. Held notices are system only.
--> statement-breakpoint
ALTER TABLE assistant_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant_contact ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant_contact FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant_instruction_version ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant_instruction_version FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant_test ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant_test FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_held_notice ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_held_notice FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY assistant_settings_system ON assistant_settings FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY assistant_contact_system ON assistant_contact FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY assistant_instruction_version_system ON assistant_instruction_version FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY assistant_test_system ON assistant_test FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY chat_held_notice_system ON chat_held_notice FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Owners and admins of the request's workspace, while it is active.
CREATE OR REPLACE FUNCTION app_can_manage_assistant(p_workspace_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT p_workspace_id = public.app_current_workspace_id()
      AND public.app_current_workspace_role() IN ('owner', 'admin')
      AND EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = p_workspace_id AND w.status = 'active')
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_manage_assistant(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_manage_assistant(uuid) TO guidesk_app;
--> statement-breakpoint
-- 1. Settings: members read; owners and admins insert and update; nobody deletes in a request.
CREATE POLICY assistant_settings_read ON assistant_settings FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY assistant_settings_insert ON assistant_settings FOR INSERT TO guidesk_app
  WITH CHECK (app_can_manage_assistant(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_settings_update ON assistant_settings FOR UPDATE TO guidesk_app
  USING (app_can_manage_assistant(workspace_id))
  WITH CHECK (app_can_manage_assistant(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT ON assistant_settings TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (autonomy, tone, quiet_enabled, quiet_start, quiet_end, contacts_mode, own_groups,
  instruction_version_id, version, updated_by, updated_at) ON assistant_settings TO guidesk_app;
--> statement-breakpoint
-- 2. Contacts: members read; owners and admins insert and delete.
CREATE POLICY assistant_contact_read ON assistant_contact FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY assistant_contact_insert ON assistant_contact FOR INSERT TO guidesk_app
  WITH CHECK (app_can_manage_assistant(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_contact_delete ON assistant_contact FOR DELETE TO guidesk_app
  USING (app_can_manage_assistant(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON assistant_contact TO guidesk_app;
--> statement-breakpoint
-- 3. Instruction versions: immutable; members read; owners and admins insert as themselves.
CREATE POLICY assistant_instruction_version_read ON assistant_instruction_version FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY assistant_instruction_version_insert ON assistant_instruction_version FOR INSERT TO guidesk_app
  WITH CHECK (app_can_manage_assistant(workspace_id) AND created_by = app_current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON assistant_instruction_version TO guidesk_app;
--> statement-breakpoint
-- 4. Tests: members read the workspace's tests; members who handle conversations create their own.
CREATE POLICY assistant_test_read ON assistant_test FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY assistant_test_insert ON assistant_test FOR INSERT TO guidesk_app
  WITH CHECK (app_can_handle_conversations(workspace_id) AND created_by = app_current_user_id());
--> statement-breakpoint
-- Drizzle names every column on insert, so the grant is table-wide; the API sets only the question
-- and its scope, and results are written by the worker (no member UPDATE grant).
GRANT SELECT, INSERT ON assistant_test TO guidesk_app;
--> statement-breakpoint
-- 5. Traces: members see the settings that applied (FR-020); test traces are host-facing too.
GRANT SELECT (assistant_test_id, autonomy_source, answer_kind, tone, quiet_hours,
  workspace_instruction_version_id, property_instruction_version_id) ON agent_trace TO guidesk_app;
--> statement-breakpoint
-- 6. Parents match: a scope's property, a contact's membership, a version's property, and a test's
--    property all belong to the row's workspace.
CREATE OR REPLACE FUNCTION assistant_scope_matches() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NEW.property_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.property p WHERE p.id = NEW.property_id AND p.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION '% does not match its property', TG_TABLE_NAME USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;
--> statement-breakpoint
CREATE TRIGGER assistant_settings_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON assistant_settings
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
--> statement-breakpoint
CREATE TRIGGER assistant_instruction_version_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON assistant_instruction_version
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
--> statement-breakpoint
CREATE TRIGGER assistant_test_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON assistant_test
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assistant_contact_matches() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.assistant_settings s WHERE s.id = NEW.settings_id AND s.workspace_id = NEW.workspace_id
    ) OR NOT EXISTS (
      SELECT 1 FROM public.membership m WHERE m.id = NEW.membership_id AND m.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'assistant_contact does not match its settings or membership' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;
--> statement-breakpoint
CREATE TRIGGER assistant_contact_matches
  BEFORE INSERT OR UPDATE ON assistant_contact
  FOR EACH ROW EXECUTE FUNCTION assistant_contact_matches();
--> statement-breakpoint
-- 7. Instruction versions never change (FR-021): even the owner connection can only insert or
--    delete them.
CREATE OR REPLACE FUNCTION assistant_instruction_version_immutable() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    RAISE EXCEPTION 'assistant_instruction_version is immutable' USING ERRCODE = 'check_violation';
  END;
  $$;
--> statement-breakpoint
CREATE TRIGGER assistant_instruction_version_immutable
  BEFORE UPDATE ON assistant_instruction_version
  FOR EACH ROW EXECUTE FUNCTION assistant_instruction_version_immutable();
