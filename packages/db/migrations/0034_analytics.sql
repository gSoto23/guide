ALTER TABLE "stay" ADD COLUMN "guide_opened_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "agent_trace_workspace_created_idx" ON "agent_trace" USING btree ("workspace_id","created_at") WHERE "agent_trace"."conversation_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "stay_property_opened_idx" ON "stay" USING btree ("property_id","guide_opened_at") WHERE "stay"."guide_opened_at" IS NOT NULL;--> statement-breakpoint
-- Feature 010 (research R4): backfill the first guide open of each stay from the sessions still kept.
UPDATE "stay" s
   SET "guide_opened_at" = f.first_open
  FROM (
    SELECT l."stay_id", min(g."created_at") AS first_open
      FROM "guide_session" g
      JOIN "stay_link" l ON l."id" = g."stay_link_id"
     GROUP BY l."stay_id"
  ) f
 WHERE f."stay_id" = s."id" AND s."guide_opened_at" IS NULL;
