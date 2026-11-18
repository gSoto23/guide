-- Row-level security and grants for feature 008 (data model, T004, SEC-14).
--
-- * Extras: members read the workspace's catalog; owners and admins (the guide writers) create,
--   edit, and delete.
-- * Requests: members read; members who handle conversations change the status columns. Requests are
--   created only by guest routes and the worker in the system context, scoped by the stay session.
-- * Daily counts: members read; member answers add to them; guest routes and the worker write them
--   in the system context.
--> statement-breakpoint
ALTER TABLE extra ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE extra FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_request ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_request FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_request_daily ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE service_request_daily FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY extra_system ON extra FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY service_request_system ON service_request FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY service_request_daily_system ON service_request_daily FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
-- 1. Extras.
CREATE POLICY extra_read ON extra FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY extra_insert ON extra FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY extra_update ON extra FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY extra_delete ON extra FOR DELETE TO guidesk_app
  USING (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON extra TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (source_language, name, description, price, currency, lead_time_hours, weekdays,
  needs_date, needs_time, date_range, max_per_stay, pre_approved, turnover, visible, position,
  version, updated_at, updated_by) ON extra TO guidesk_app;
--> statement-breakpoint
CREATE TRIGGER extra_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON extra
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
--> statement-breakpoint
-- 2. Requests: the stay must belong to the request's property and workspace.
CREATE OR REPLACE FUNCTION service_request_stay_matches() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM public.stay s
       WHERE s.id = NEW.stay_id AND s.property_id = NEW.property_id AND s.workspace_id = NEW.workspace_id
    ) THEN
      RAISE EXCEPTION 'service_request does not match its stay' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END;
  $$;
--> statement-breakpoint
CREATE TRIGGER service_request_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON service_request
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
--> statement-breakpoint
CREATE TRIGGER service_request_matches_stay
  BEFORE INSERT OR UPDATE OF workspace_id, property_id, stay_id ON service_request
  FOR EACH ROW EXECUTE FUNCTION service_request_stay_matches();
--> statement-breakpoint
CREATE POLICY service_request_read ON service_request FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY service_request_answer ON service_request FOR UPDATE TO guidesk_app
  USING (app_can_handle_conversations(workspace_id))
  WITH CHECK (app_can_handle_conversations(workspace_id));
--> statement-breakpoint
GRANT SELECT ON service_request TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (status, reason_code, reason_text, answered_by, answered_at) ON service_request TO guidesk_app;
--> statement-breakpoint
-- 3. Daily counts.
CREATE TRIGGER service_request_daily_matches_property
  BEFORE INSERT OR UPDATE OF workspace_id, property_id ON service_request_daily
  FOR EACH ROW EXECUTE FUNCTION assistant_scope_matches();
--> statement-breakpoint
CREATE POLICY service_request_daily_read ON service_request_daily FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY service_request_daily_insert ON service_request_daily FOR INSERT TO guidesk_app
  WITH CHECK (app_can_handle_conversations(workspace_id));
--> statement-breakpoint
CREATE POLICY service_request_daily_update ON service_request_daily FOR UPDATE TO guidesk_app
  USING (app_can_handle_conversations(workspace_id))
  WITH CHECK (app_can_handle_conversations(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT ON service_request_daily TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (count) ON service_request_daily TO guidesk_app;
