-- Row-level security and grants for feature 006 (data model, T005, SEC-14).
--
-- * Request context (guidesk_app): members read the workspace's copilot drafts, presence, and
--   dismissed suggestions; members who handle conversations create their own copilot drafts and
--   presence and dismiss suggestions; they also mark conversations done and take them over. Push
--   subscriptions belong to their user, whatever the workspace.
-- * System context (the owner connection): the reply, copilot, and push jobs; retention; and the
--   push subscription upsert by endpoint (an endpoint can move to whoever signs in on that browser).
--> statement-breakpoint
ALTER TABLE copilot_run ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE copilot_run FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE push_subscription FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE conversation_presence ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE conversation_presence FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant_suggestion_dismissal ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE assistant_suggestion_dismissal FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY copilot_run_system ON copilot_run FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY push_subscription_system ON push_subscription FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY conversation_presence_system ON conversation_presence FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY assistant_suggestion_dismissal_system ON assistant_suggestion_dismissal FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
-- 1. Conversations: the new columns are readable, and members who handle conversations set them.
ALTER TABLE conversation ADD CONSTRAINT conversation_taken_over_consistent
  CHECK ((taken_over_by IS NULL) = (taken_over_at IS NULL) OR (taken_over_by IS NULL AND taken_over_at IS NOT NULL));
--> statement-breakpoint
GRANT SELECT (done_at, done_by, taken_over_by, taken_over_at) ON conversation TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (done_at, done_by, taken_over_by, taken_over_at) ON conversation TO guidesk_app;
--> statement-breakpoint
-- 2. Copilot drafts: members read; members who handle conversations create their own.
CREATE POLICY copilot_run_read ON copilot_run FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY copilot_run_insert ON copilot_run FOR INSERT TO guidesk_app
  WITH CHECK (app_can_handle_conversations(workspace_id) AND created_by = app_current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON copilot_run TO guidesk_app;
--> statement-breakpoint
CREATE TRIGGER copilot_run_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON copilot_run
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
--> statement-breakpoint
GRANT SELECT (copilot_run_id) ON agent_trace TO guidesk_app;
--> statement-breakpoint
-- 3. Push subscriptions: each user sees and removes only their own.
CREATE POLICY push_subscription_own ON push_subscription FOR SELECT TO guidesk_app
  USING (user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY push_subscription_delete ON push_subscription FOR DELETE TO guidesk_app
  USING (user_id = app_current_user_id());
--> statement-breakpoint
GRANT SELECT (id, user_id, device, created_at, last_success_at), DELETE ON push_subscription TO guidesk_app;
--> statement-breakpoint
-- 4. Presence: members read the workspace's; members who handle conversations write their own.
CREATE POLICY conversation_presence_read ON conversation_presence FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY conversation_presence_insert ON conversation_presence FOR INSERT TO guidesk_app
  WITH CHECK (app_can_handle_conversations(workspace_id) AND user_id = app_current_user_id());
--> statement-breakpoint
CREATE POLICY conversation_presence_update ON conversation_presence FOR UPDATE TO guidesk_app
  USING (app_can_handle_conversations(workspace_id) AND user_id = app_current_user_id())
  WITH CHECK (app_can_handle_conversations(workspace_id) AND user_id = app_current_user_id());
--> statement-breakpoint
GRANT SELECT, INSERT ON conversation_presence TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (expires_at) ON conversation_presence TO guidesk_app;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION conversation_presence_matches() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.conversation c WHERE c.id = NEW.conversation_id AND c.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'conversation_presence does not match its conversation' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;
--> statement-breakpoint
CREATE TRIGGER conversation_presence_matches
  BEFORE INSERT OR UPDATE OF conversation_id, workspace_id ON conversation_presence
  FOR EACH ROW EXECUTE FUNCTION conversation_presence_matches();
--> statement-breakpoint
-- 5. Dismissed suggestions: members read; members who handle conversations dismiss.
CREATE POLICY assistant_suggestion_dismissal_read ON assistant_suggestion_dismissal FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY assistant_suggestion_dismissal_insert ON assistant_suggestion_dismissal FOR INSERT TO guidesk_app
  WITH CHECK (app_can_handle_conversations(workspace_id));
--> statement-breakpoint
CREATE POLICY assistant_suggestion_dismissal_update ON assistant_suggestion_dismissal FOR UPDATE TO guidesk_app
  USING (app_can_handle_conversations(workspace_id))
  WITH CHECK (app_can_handle_conversations(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT ON assistant_suggestion_dismissal TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (dismissed_until, dismissed_by) ON assistant_suggestion_dismissal TO guidesk_app;
--> statement-breakpoint
CREATE TRIGGER assistant_suggestion_dismissal_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON assistant_suggestion_dismissal
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
