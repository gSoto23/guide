-- Row-level security, grants, locked-field access, and the guide backfill for feature 003
-- (data model §1–§6, T019, SEC-14).
--
-- Same two contexts as features 001 and 002:
-- * Request context (guidesk_app): every member reads guides; owners and admins write them, and
--   only while the workspace is active (FR-063, edge case "workspace pending deletion").
-- * System context (the owner connection): worker jobs (drafting, translation, the interview,
--   documents, media, shared-block fan-out, retention) and the reveal service's single read.
--
-- Locked-field values (restricted_value.value_ciphertext and public_value) are never selectable
-- by guidesk_app; members see locked fields through restricted_value_public (SEC-06).
--> statement-breakpoint
-- 1. Row-level security on the 13 new tables, enabled and forced.
--> statement-breakpoint
ALTER TABLE guide ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_section ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_section FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_item ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_item FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_item_text ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_item_text FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_topic_mark ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_topic_mark FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_version ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_version FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shared_block ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE shared_block FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_shared_link ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_shared_link FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE media_object ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE media_object FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_document ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_document FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interview_session ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interview_session FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interview_turn ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE interview_turn FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_ai_request ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE guide_ai_request FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- 2. System context (owner connection): worker jobs and the reveal service.
--> statement-breakpoint
CREATE POLICY guide_system ON guide FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY guide_section_system ON guide_section FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY guide_item_system ON guide_item FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY guide_item_text_system ON guide_item_text FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY guide_topic_mark_system ON guide_topic_mark FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY guide_version_system ON guide_version FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY shared_block_system ON shared_block FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY guide_shared_link_system ON guide_shared_link FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY media_object_system ON media_object FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY guide_document_system ON guide_document FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY interview_session_system ON interview_session FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY interview_turn_system ON interview_turn FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY guide_ai_request_system ON guide_ai_request FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
-- 3. A helper for write policies: owners and admins of the request's workspace while it is
-- active. SECURITY DEFINER so the status is read whatever the workspace policies show.
CREATE OR REPLACE FUNCTION app_can_write_guides(p_workspace_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog, public
  AS $$
    SELECT p_workspace_id = public.app_current_workspace_id()
      AND public.app_current_workspace_role() IN ('owner', 'admin')
      AND EXISTS (SELECT 1 FROM public.workspace w WHERE w.id = p_workspace_id AND w.status = 'active')
  $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_can_write_guides(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_can_write_guides(uuid) TO guidesk_app;
--> statement-breakpoint
-- 4. Guides, sections, items, texts, and topic marks: members read; owners and admins write.
--> statement-breakpoint
CREATE POLICY guide_read ON guide FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY guide_insert ON guide FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_update ON guide FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON guide TO guidesk_app;
--> statement-breakpoint
CREATE POLICY guide_section_read ON guide_section FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY guide_section_insert ON guide_section FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_section_update ON guide_section FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_section_delete ON guide_section FOR DELETE TO guidesk_app
  USING (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON guide_section TO guidesk_app;
--> statement-breakpoint
CREATE POLICY guide_item_read ON guide_item FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY guide_item_insert ON guide_item FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_item_update ON guide_item FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_item_delete ON guide_item FOR DELETE TO guidesk_app
  USING (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON guide_item TO guidesk_app;
--> statement-breakpoint
CREATE POLICY guide_item_text_read ON guide_item_text FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY guide_item_text_insert ON guide_item_text FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_item_text_update ON guide_item_text FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_item_text_delete ON guide_item_text FOR DELETE TO guidesk_app
  USING (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON guide_item_text TO guidesk_app;
--> statement-breakpoint
CREATE POLICY guide_topic_mark_read ON guide_topic_mark FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY guide_topic_mark_insert ON guide_topic_mark FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_topic_mark_update ON guide_topic_mark FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_topic_mark_delete ON guide_topic_mark FOR DELETE TO guidesk_app
  USING (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON guide_topic_mark TO guidesk_app;
--> statement-breakpoint
-- 5. Published versions are insert-only for requests (research R12). Retention deletes old ones
-- in the system context.
--> statement-breakpoint
CREATE POLICY guide_version_read ON guide_version FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY guide_version_insert ON guide_version FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT ON guide_version TO guidesk_app;
--> statement-breakpoint
-- 6. Shared content (FR-057 to FR-062).
--> statement-breakpoint
CREATE POLICY shared_block_read ON shared_block FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY shared_block_insert ON shared_block FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY shared_block_update ON shared_block FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY shared_block_delete ON shared_block FOR DELETE TO guidesk_app
  USING (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON shared_block TO guidesk_app;
--> statement-breakpoint
CREATE POLICY guide_shared_link_read ON guide_shared_link FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY guide_shared_link_insert ON guide_shared_link FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_shared_link_update ON guide_shared_link FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_shared_link_delete ON guide_shared_link FOR DELETE TO guidesk_app
  USING (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON guide_shared_link TO guidesk_app;
--> statement-breakpoint
-- 7. Media, documents, and the interview. Deleting media objects is the worker's sweep.
--> statement-breakpoint
CREATE POLICY media_object_read ON media_object FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY media_object_insert ON media_object FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY media_object_update ON media_object FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON media_object TO guidesk_app;
--> statement-breakpoint
CREATE POLICY guide_document_read ON guide_document FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY guide_document_insert ON guide_document FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_document_update ON guide_document FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY guide_document_delete ON guide_document FOR DELETE TO guidesk_app
  USING (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON guide_document TO guidesk_app;
--> statement-breakpoint
CREATE POLICY interview_session_read ON interview_session FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY interview_session_insert ON interview_session FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY interview_session_update ON interview_session FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON interview_session TO guidesk_app;
--> statement-breakpoint
CREATE POLICY interview_turn_read ON interview_turn FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY interview_turn_insert ON interview_turn FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY interview_turn_update ON interview_turn FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON interview_turn TO guidesk_app;
--> statement-breakpoint
-- 8. AI usage rows: written by the worker, read by owners and admins (constitution VIII).
--> statement-breakpoint
CREATE POLICY guide_ai_request_read ON guide_ai_request FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IN ('owner', 'admin'));
--> statement-breakpoint
GRANT SELECT ON guide_ai_request TO guidesk_app;
--> statement-breakpoint
-- 9. Locked fields (feature 003 data model §2). Owners and admins add, change, and delete them
-- from requests; the value columns can be written but never read back (SEC-06). The reveal
-- service reads one value in the system context after its checks (research R4).
CREATE POLICY restricted_value_insert ON restricted_value FOR INSERT TO guidesk_app
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY restricted_value_update ON restricted_value FOR UPDATE TO guidesk_app
  USING (app_can_write_guides(workspace_id))
  WITH CHECK (app_can_write_guides(workspace_id));
--> statement-breakpoint
CREATE POLICY restricted_value_delete ON restricted_value FOR DELETE TO guidesk_app
  USING (app_can_write_guides(workspace_id));
--> statement-breakpoint
GRANT SELECT (section_kind, value_set_at, updated_by) ON restricted_value TO guidesk_app;
--> statement-breakpoint
GRANT INSERT (id, workspace_id, property_id, kind, label, value_ciphertext, data_key_id, public_value,
  source, source_field, section_kind, value_set_at, updated_by, created_at, updated_at)
  ON restricted_value TO guidesk_app;
--> statement-breakpoint
GRANT UPDATE (label, value_ciphertext, data_key_id, public_value, section_kind, value_set_at, updated_by,
  updated_at) ON restricted_value TO guidesk_app;
--> statement-breakpoint
GRANT DELETE ON restricted_value TO guidesk_app;
--> statement-breakpoint
-- What every member, agents included, may see of a locked field (FR-063): never the value.
-- The view runs with its owner's rights, so it filters itself to the request's workspace and
-- returns nothing without a workspace context or a role there.
CREATE VIEW restricted_value_public WITH (security_barrier = true) AS
  SELECT id, workspace_id, property_id, kind, label, section_kind, source,
         (value_ciphertext IS NOT NULL OR public_value IS NOT NULL) AS is_set,
         (public_value IS NOT NULL) AS is_public,
         value_set_at, updated_by, created_at, updated_at
  FROM restricted_value
  WHERE workspace_id = app_current_workspace_id()
    AND app_current_workspace_role() IS NOT NULL;
--> statement-breakpoint
GRANT SELECT ON restricted_value_public TO guidesk_app;
--> statement-breakpoint
-- 10. Backfill: every existing property gets its guide, the nine default sections, and the fact
-- items (feature 003 research R16). The AI part of the draft runs when the guide is first opened.
INSERT INTO guide (workspace_id, property_id)
  SELECT p.workspace_id, p.id FROM property p
  WHERE NOT EXISTS (SELECT 1 FROM guide g WHERE g.property_id = p.id);
--> statement-breakpoint
INSERT INTO guide_section (workspace_id, guide_id, kind, position)
  SELECT g.workspace_id, g.id, k.kind, k.position
  FROM guide g
  CROSS JOIN (VALUES ('arrival', 0), ('wifi', 1), ('house_rules', 2), ('appliances', 3),
                     ('amenities', 4), ('parking', 5), ('local_recommendations', 6),
                     ('emergency', 7), ('checkout', 8)) AS k(kind, position)
  WHERE NOT EXISTS (SELECT 1 FROM guide_section s WHERE s.guide_id = g.id AND s.kind = k.kind);
--> statement-breakpoint
INSERT INTO guide_item (workspace_id, section_id, kind, position, source, reviewed_at, source_language, fact_key)
  SELECT s.workspace_id, s.id, 'fact', f.position, 'host', now(), p.guide_languages[1], f.fact_key
  FROM guide_section s
  JOIN guide g ON g.id = s.guide_id
  JOIN property p ON p.id = g.property_id
  JOIN (VALUES ('arrival', 'check_in_time', 0), ('arrival', 'address', 1),
               ('house_rules', 'max_guests', 0), ('checkout', 'checkout_time', 0))
    AS f(section_kind, fact_key, position) ON f.section_kind = s.kind
  WHERE NOT EXISTS (
    SELECT 1 FROM guide_item i WHERE i.section_id = s.id AND i.fact_key = f.fact_key
  );
