-- Row-level security and grants for feature 009 (data model, T004, SEC-14).
--
-- * Partner tables (experience_destination, experience_refresh, experience,
--   experience_partner_reference) hold public partner content, not tenant data: the worker writes them
--   in the system context; members may read them (the Explore settings screen lists a destination's
--   experiences). Nobody writes them in a request.
-- * Tenant tables: members read the workspace's Explore settings and counts; owners and admins write
--   settings (`properties.manage`, the guide writers). Guest routes write counts in the system context,
--   scoped by the property link.
--> statement-breakpoint
ALTER TABLE experience_destination ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE experience_destination FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE experience_refresh ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE experience_refresh FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE experience ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE experience FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE experience_partner_reference ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE experience_partner_reference FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE explore_settings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE explore_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE explore_open_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE explore_open_daily FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE experience_click_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE experience_click_daily FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY experience_destination_system ON experience_destination FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY experience_refresh_system ON experience_refresh FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY experience_system ON experience FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY experience_partner_reference_system ON experience_partner_reference FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY explore_settings_system ON explore_settings FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY explore_open_daily_system ON explore_open_daily FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY experience_click_daily_system ON experience_click_daily FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
-- 1. Partner content: read-only for members in a request.
CREATE POLICY experience_destination_read ON experience_destination FOR SELECT TO guidesk_app
  USING (app_current_user_id() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY experience_read ON experience FOR SELECT TO guidesk_app
  USING (app_current_user_id() IS NOT NULL);
--> statement-breakpoint
GRANT SELECT ON experience_destination, experience TO guidesk_app;
--> statement-breakpoint
-- 2. Explore settings: members read; owners and admins insert and update; nobody deletes in a request.
CREATE POLICY explore_settings_read ON explore_settings FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY explore_settings_insert ON explore_settings FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY explore_settings_update ON explore_settings FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT ON explore_settings TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (follows_default, experiences_enabled, hidden_categories, hidden_experiences, version,
  updated_by, updated_at) ON explore_settings TO guidesk_app;
--> statement-breakpoint
CREATE TRIGGER explore_settings_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON explore_settings
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
--> statement-breakpoint
-- 3. Counts: members read the workspace's; only guest routes and the worker (system) write them.
CREATE POLICY explore_open_daily_read ON explore_open_daily FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY experience_click_daily_read ON experience_click_daily FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
GRANT SELECT ON explore_open_daily, experience_click_daily TO guidesk_app;
--> statement-breakpoint
CREATE TRIGGER explore_open_daily_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON explore_open_daily
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
--> statement-breakpoint
CREATE TRIGGER experience_click_daily_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON experience_click_daily
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
