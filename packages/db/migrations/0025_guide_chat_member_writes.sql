-- Feature 005 member writes (research R11, FR-022, FR-027).
--
-- * A draft a member sends appears to the guest as the assistant (FR-027): members who handle
--   conversations may insert an assistant message only as themselves (`author_user_id`), so every
--   such message names the member who sent it. Guest messages stay system-only.
-- * Owners and admins set the assistant's autonomy for the workspace and per property (FR-022);
--   the existing UPDATE policies already limit who may update those rows.
--> statement-breakpoint
DROP POLICY chat_message_insert ON chat_message;
--> statement-breakpoint
CREATE POLICY chat_message_insert ON chat_message FOR INSERT TO guidesk_app
  WITH CHECK (
    app_can_handle_conversations(workspace_id)
    AND (author = 'host' OR (author = 'assistant' AND author_user_id = app_current_user_id()))
  );
--> statement-breakpoint
GRANT UPDATE (assistant_autonomy) ON workspace TO guidesk_app;
