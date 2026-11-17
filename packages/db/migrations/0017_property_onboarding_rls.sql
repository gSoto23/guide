-- Row-level security, grants, and guards for feature 002 (data model §1–§4, T014, SEC-14).
--
-- Same two contexts as feature 001 (migration 0005):
-- * Request context: handlers run as guidesk_app. Owners and admins manage properties and
--   integrations; agents read properties, listing content, stays, and the feed view only (FR-046).
-- * System context: the owner connection used by worker jobs (imports, refreshes, retention,
--   purges). Explicit "system" policies grant it full access.
--
-- Restricted columns (*_ciphertext) are never selectable by guidesk_app: those tables get
-- column-level SELECT grants, so request queries name their columns (SEC-06, research R5).

-- 1. Row-level security on all 11 tables, enabled and forced.
ALTER TABLE property ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE property FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE listing_content ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE listing_content FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE restricted_value ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE restricted_value FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspace_data_key ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE workspace_data_key FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE upload ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE upload FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE extraction_request ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE extraction_request FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE calendar_feed ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE calendar_feed FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stay ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE stay FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pms_connection ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE pms_connection FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE import_run ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE import_run FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE import_item ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE import_item FORCE ROW LEVEL SECURITY;
--> statement-breakpoint

-- 2. System context (owner connection): worker jobs.
CREATE POLICY property_system ON property FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY listing_content_system ON listing_content FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY restricted_value_system ON restricted_value FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY workspace_data_key_system ON workspace_data_key FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY upload_system ON upload FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY extraction_request_system ON extraction_request FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY calendar_feed_system ON calendar_feed FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY stay_system ON stay FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY pms_connection_system ON pms_connection FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY import_run_system ON import_run FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY import_item_system ON import_item FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint

-- 3. Properties. Members read active properties; owners and admins also read removed ones, to
-- restore them (FR-045). Owners and admins create and change them; nobody deletes them from a
-- request (removal is a status change, and the purge runs in the system context).
CREATE POLICY property_read ON property FOR SELECT TO guidesk_app
  USING (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IS NOT NULL
    AND (status = 'active' OR app_current_workspace_role() IN ('owner', 'admin'))
  );
--> statement-breakpoint
-- No new property while the workspace is pending deletion (FR-049). The role is already empty for
-- non-owners of such a workspace (migration 0015); this also covers its owner.
CREATE POLICY property_insert ON property FOR INSERT TO guidesk_app
  WITH CHECK (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IN ('owner', 'admin')
    AND EXISTS (SELECT 1 FROM workspace w WHERE w.id = property.workspace_id AND w.status = 'active')
  );
--> statement-breakpoint
CREATE POLICY property_update ON property FOR UPDATE TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON property TO guidesk_app;
--> statement-breakpoint

-- 4. Listing content: members read; owners and admins write (FR-033, FR-046).
CREATE POLICY listing_content_read ON listing_content FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY listing_content_insert ON listing_content FOR INSERT TO guidesk_app
  WITH CHECK (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
CREATE POLICY listing_content_update ON listing_content FOR UPDATE TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON listing_content TO guidesk_app;
--> statement-breakpoint

-- 5. Restricted values: written only by imports (system context). Owners and admins read the
-- masked fields; nobody reads the ciphertext from a request (FR-031).
CREATE POLICY restricted_value_read ON restricted_value FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT (id, workspace_id, property_id, kind, label, data_key_id, source, source_field, created_at, updated_at)
  ON restricted_value TO guidesk_app;
--> statement-breakpoint

-- 6. Data keys: owners and admins, who write restricted data, read the wrapped key and create
-- the first one. Rotation and retirement run in the system context (research R5).
CREATE POLICY workspace_data_key_read ON workspace_data_key FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
CREATE POLICY workspace_data_key_insert ON workspace_data_key FOR INSERT TO guidesk_app
  WITH CHECK (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IN ('owner', 'admin')
    AND status = 'active'
  );
--> statement-breakpoint
GRANT SELECT, INSERT ON workspace_data_key TO guidesk_app;
--> statement-breakpoint

-- 7. Owner-and-admin tables: uploads, extraction requests, PMS connections, import runs and
-- items (FR-046). Agents never see them.
CREATE POLICY upload_manage ON upload FOR ALL TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON upload TO guidesk_app;
--> statement-breakpoint
CREATE POLICY extraction_request_manage ON extraction_request FOR ALL TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON extraction_request TO guidesk_app;
--> statement-breakpoint
CREATE POLICY pms_connection_manage ON pms_connection FOR ALL TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT (
  id, workspace_id, provider, external_account_id, account_label, data_key_id, status,
  last_refresh_at, failing_since, alerted_at, manual_refresh_at, last_error_code,
  connected_by, connected_at, disconnected_by, disconnected_at
) ON pms_connection TO guidesk_app;
--> statement-breakpoint
GRANT INSERT, UPDATE ON pms_connection TO guidesk_app;
--> statement-breakpoint
CREATE POLICY import_run_manage ON import_run FOR ALL TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON import_run TO guidesk_app;
--> statement-breakpoint
CREATE POLICY import_item_manage ON import_item FOR ALL TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT (
  id, workspace_id, import_run_id, row_number, external_id, label, selected, outcome,
  reason_code, errors, warnings, row_values, data_key_id, property_id
) ON import_item TO guidesk_app;
--> statement-breakpoint
GRANT INSERT, UPDATE ON import_item TO guidesk_app;
--> statement-breakpoint

-- 8. Calendar feeds: owners and admins only, without the link ciphertext (FR-025). Deleting a
-- feed deletes its stays through the foreign key.
CREATE POLICY calendar_feed_manage ON calendar_feed FOR ALL TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT (
  id, workspace_id, property_id, channel, channel_label, url_fingerprint, display_hint,
  data_key_id, status, last_success_at, last_attempt_at, failing_since, alerted_at,
  last_error_code, etag, last_modified, manual_refresh_at, created_by, created_at, updated_at
) ON calendar_feed TO guidesk_app;
--> statement-breakpoint
GRANT INSERT, UPDATE, DELETE ON calendar_feed TO guidesk_app;
--> statement-breakpoint
-- What every member, agents included, may see of a feed (FR-025, US3 scenario 6). The view runs
-- with its owner's rights, so the table's policies do not apply to it: it filters itself to the
-- request's workspace and returns nothing without a workspace context or a role there.
CREATE VIEW calendar_feed_public WITH (security_barrier = true) AS
  SELECT id, workspace_id, property_id, channel, channel_label, status, last_success_at,
         last_attempt_at, failing_since, last_error_code, created_at
  FROM calendar_feed
  WHERE workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IS NOT NULL;
--> statement-breakpoint
GRANT SELECT ON calendar_feed_public TO guidesk_app;
--> statement-breakpoint
-- At most 5 feeds per property (FR-020). The property row is locked, so two parallel inserts
-- cannot both pass the count.
CREATE OR REPLACE FUNCTION calendar_feed_enforce_limit() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
BEGIN
  PERFORM 1 FROM public.property p WHERE p.id = NEW.property_id FOR UPDATE;
  IF (SELECT count(*) FROM public.calendar_feed f WHERE f.property_id = NEW.property_id) >= 5 THEN
    RAISE EXCEPTION 'feed_limit_reached: a property can have at most 5 calendar feeds'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION calendar_feed_enforce_limit() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER calendar_feed_limit
  BEFORE INSERT ON calendar_feed
  FOR EACH ROW EXECUTE FUNCTION calendar_feed_enforce_limit();
--> statement-breakpoint

-- 9. Stays: members read, agents included (FR-046). Owners and admins add manual stays, insert
-- the stays of a feed they save, and change stays; the trigger below limits what a request may
-- change on feed and PMS stays.
CREATE POLICY stay_read ON stay FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
-- Requests insert manual stays, and the stays of a feed being saved (FR-021), which must belong
-- to a feed of the same property and carry no guest data (check constraint). PMS stays are
-- written only by the worker's system context.
CREATE POLICY stay_insert ON stay FOR INSERT TO guidesk_app
  WITH CHECK (
    workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IN ('owner', 'admin')
    AND (
      source = 'manual'
      OR (
        source = 'ical'
        AND EXISTS (
          SELECT 1 FROM calendar_feed f
          WHERE f.id = stay.calendar_feed_id
            AND f.workspace_id = stay.workspace_id
            AND f.property_id = stay.property_id
        )
      )
    )
  );
--> statement-breakpoint
CREATE POLICY stay_update ON stay FOR UPDATE TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'))
  WITH CHECK (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON stay TO guidesk_app;
--> statement-breakpoint
-- In the request context, feed and PMS stays allow only two changes (FR-053): `active` → `hidden`
-- when the entry may be a block, and removing the guest name. Manual stays keep their source and
-- property. The system context (refreshes) is not limited here; it still cannot write a guest
-- name back while `guest_name_removed_at` is set (check constraint stay_guest_name_removed).
CREATE OR REPLACE FUNCTION stay_guard_request_changes() RETURNS trigger
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
  AS $$
BEGIN
  IF current_user <> 'guidesk_app' THEN
    RETURN NEW;
  END IF;
  IF NEW.source <> OLD.source OR NEW.property_id <> OLD.property_id OR NEW.workspace_id <> OLD.workspace_id THEN
    RAISE EXCEPTION 'stay_change_not_allowed: source and property cannot change'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.guest_name_removed_at IS NOT NULL AND NEW.guest_name_removed_at IS DISTINCT FROM OLD.guest_name_removed_at THEN
    RAISE EXCEPTION 'stay_change_not_allowed: a guest name removal cannot be undone'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.source = 'manual' THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'guest_name' - 'guest_name_removed_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'guest_name' - 'guest_name_removed_at' - 'updated_at') THEN
    RAISE EXCEPTION 'stay_change_not_allowed: feed and PMS stays allow only hiding and guest name removal'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'active' AND NEW.status = 'hidden' AND OLD.may_be_block) THEN
    RAISE EXCEPTION 'stay_change_not_allowed: only a stay that may be a block can be hidden'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.guest_name IS DISTINCT FROM OLD.guest_name
     AND NOT (NEW.guest_name IS NULL AND NEW.guest_name_removed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'stay_change_not_allowed: a guest name can only be removed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER stay_guard_request
  BEFORE UPDATE ON stay
  FOR EACH ROW EXECUTE FUNCTION stay_guard_request_changes();
