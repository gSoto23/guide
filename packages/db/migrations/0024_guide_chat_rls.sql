-- Row-level security and grants for feature 005 (data model §1–§3, T008, SEC-14).
--
-- * Request context (guidesk_app): every member reads conversations, messages, drafts, usage, and
--   the member columns of traces (never model, tokens, or cost). Members who handle conversations
--   (owners, admins, agents: spec 001 `conversations.handle`) write replies and draft actions while
--   the workspace is active.
-- * System context (the owner connection): guest chat routes after resolving the guide (spec 004
--   research R12), the `chat.reply` job, the cost check, and retention.
--> statement-breakpoint
ALTER TABLE conversation ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE conversation FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_message ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_message FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_trace ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_trace FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_draft ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE agent_draft FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_usage_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE chat_usage_daily FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY conversation_system ON conversation FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY chat_message_system ON chat_message FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY agent_trace_system ON agent_trace FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY agent_draft_system ON agent_draft FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY chat_usage_daily_system ON chat_usage_daily FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
-- Members of the request's workspace who handle conversations, while it is active.
CREATE OR REPLACE FUNCTION app_can_handle_conversations(p_workspace_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT p_workspace_id = public.app_current_workspace_id()
      AND public.app_current_workspace_role() IN ('owner', 'admin', 'agent')
      AND EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = p_workspace_id AND w.status = 'active')
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_handle_conversations(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_handle_conversations(uuid) TO guidesk_app;
--> statement-breakpoint
CREATE POLICY conversation_read ON conversation FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY conversation_update ON conversation FOR UPDATE TO guidesk_app
  USING (app_can_handle_conversations(workspace_id))
  WITH CHECK (app_can_handle_conversations(workspace_id));
--> statement-breakpoint
GRANT SELECT (id, workspace_id, property_id, stay_id, status, needs_host_reason, language,
  last_message_at, last_notified_at, created_at) ON conversation TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (status, needs_host_reason, last_message_at) ON conversation TO guidesk_app;
--> statement-breakpoint
CREATE POLICY chat_message_read ON chat_message FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY chat_message_insert ON chat_message FOR INSERT TO guidesk_app
  WITH CHECK (app_can_handle_conversations(workspace_id) AND author = 'host');
--> statement-breakpoint
GRANT SELECT, INSERT ON chat_message TO guidesk_app;
--> statement-breakpoint
CREATE POLICY agent_draft_read ON agent_draft FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY agent_draft_update ON agent_draft FOR UPDATE TO guidesk_app
  USING (app_can_handle_conversations(workspace_id))
  WITH CHECK (app_can_handle_conversations(workspace_id));
--> statement-breakpoint
GRANT SELECT ON agent_draft TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (status, acted_by, acted_at) ON agent_draft TO guidesk_app;
--> statement-breakpoint
-- Traces: members see the host-facing columns only (FR-031); model, tokens, and cost stay with
-- Guidesk operations.
CREATE POLICY agent_trace_read ON agent_trace FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY agent_trace_update ON agent_trace FOR UPDATE TO guidesk_app
  USING (app_can_handle_conversations(workspace_id))
  WITH CHECK (app_can_handle_conversations(workspace_id));
--> statement-breakpoint
GRANT SELECT (id, workspace_id, conversation_id, guest_message_id, reply_message_id, classification,
  decision, reason, autonomy, guide_version_id, section_ids, checks, sent_by, edited, created_at)
  ON agent_trace TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (sent_by, edited) ON agent_trace TO guidesk_app;
--> statement-breakpoint
CREATE POLICY chat_usage_daily_read ON chat_usage_daily FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
GRANT SELECT ON chat_usage_daily TO guidesk_app;
