ALTER TABLE "stay" DROP CONSTRAINT "stay_ical_no_guest_data";--> statement-breakpoint
ALTER TABLE "stay" ADD COLUMN "guest_details_source" text;--> statement-breakpoint
ALTER TABLE "stay" ADD COLUMN "guest_details_by" text;--> statement-breakpoint
ALTER TABLE "stay" ADD COLUMN "guest_details_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "stay" ADD CONSTRAINT "stay_guest_details_by_user_id_fk" FOREIGN KEY ("guest_details_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_stay_idx" ON "conversation" USING btree ("stay_id");--> statement-breakpoint
ALTER TABLE "stay" ADD CONSTRAINT "stay_ical_guest_data" CHECK ("stay"."source" <> 'ical' OR "stay"."guest_details_source" = 'host' OR ("stay"."guest_name" IS NULL AND "stay"."guest_count" IS NULL));--> statement-breakpoint
ALTER TABLE "stay" ADD CONSTRAINT "stay_guest_details_source_valid" CHECK ("stay"."guest_details_source" IS NULL OR "stay"."guest_details_source" IN ('feed', 'pms', 'host'));--> statement-breakpoint
-- Feature 018 (data model): where existing guest details came from.
UPDATE stay SET guest_details_source = 'pms'
 WHERE source = 'pms' AND (guest_name IS NOT NULL OR guest_count IS NOT NULL);
--> statement-breakpoint
UPDATE stay SET guest_details_source = 'host'
 WHERE source = 'manual' AND (guest_name IS NOT NULL OR guest_count IS NOT NULL);
--> statement-breakpoint
-- Feature 018 (research R3): request-side changes to stays. Owners and admins may now set the guest
-- name, the number of guests, and who set them on feed and PMS stays too (the API checks the role).
-- Everything else about those stays stays read-only, and a removed name is still final: once
-- `guest_name_removed_at` is set, no request may write a name again.
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
  IF OLD.guest_name_removed_at IS NOT NULL AND NEW.guest_name IS NOT NULL THEN
    RAISE EXCEPTION 'stay_change_not_allowed: a removed guest name cannot be set again'
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.source = 'manual' THEN
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'guest_name' - 'guest_name_removed_at' - 'guest_count'
        - 'guest_details_source' - 'guest_details_by' - 'guest_details_at' - 'updated_at')
     IS DISTINCT FROM
     (to_jsonb(OLD) - 'status' - 'guest_name' - 'guest_name_removed_at' - 'guest_count'
        - 'guest_details_source' - 'guest_details_by' - 'guest_details_at' - 'updated_at') THEN
    RAISE EXCEPTION 'stay_change_not_allowed: feed and PMS stays allow only hiding and guest details'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status <> OLD.status AND NOT (OLD.status = 'active' AND NEW.status = 'hidden' AND OLD.may_be_block) THEN
    RAISE EXCEPTION 'stay_change_not_allowed: only a stay that may be a block can be hidden'
      USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.guest_name IS DISTINCT FROM OLD.guest_name OR NEW.guest_count IS DISTINCT FROM OLD.guest_count)
     AND NOT (NEW.guest_name IS NULL AND NEW.guest_name_removed_at IS NOT NULL
              AND NEW.guest_count IS NOT DISTINCT FROM OLD.guest_count)
     AND NEW.guest_details_source IS DISTINCT FROM 'host' THEN
    RAISE EXCEPTION 'stay_change_not_allowed: guest details typed in Guidesk must be marked as the host''s'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

