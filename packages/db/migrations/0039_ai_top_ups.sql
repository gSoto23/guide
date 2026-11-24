CREATE TABLE "ai_top_up" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"replies_granted" integer NOT NULL,
	"replies_used" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT (now() + interval '12 months') NOT NULL,
	"note" text NOT NULL,
	"corrected_at" timestamp with time zone,
	"correction_note" text,
	"exhausted_notified_at" timestamp with time zone,
	CONSTRAINT "ai_top_up_granted_range" CHECK ("ai_top_up"."replies_granted" BETWEEN 0 AND 100000),
	CONSTRAINT "ai_top_up_used_range" CHECK ("ai_top_up"."replies_used" >= 0 AND "ai_top_up"."replies_used" <= "ai_top_up"."replies_granted"),
	CONSTRAINT "ai_top_up_note_length" CHECK (char_length("ai_top_up"."note") BETWEEN 1 AND 200),
	CONSTRAINT "ai_top_up_correction_note_length" CHECK ("ai_top_up"."correction_note" IS NULL OR char_length("ai_top_up"."correction_note") BETWEEN 1 AND 200)
);
--> statement-breakpoint
ALTER TABLE "chat_usage_daily" ADD COLUMN "top_up_replies" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_top_up" ADD CONSTRAINT "ai_top_up_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_top_up_workspace_idx" ON "ai_top_up" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_top_up_open_idx" ON "ai_top_up" USING btree ("workspace_id","created_at") WHERE "ai_top_up"."replies_used" < "ai_top_up"."replies_granted";--> statement-breakpoint
-- Feature 019 (data model): top-ups are written by system code only (the worker and the founder
-- tool); members of the request's workspace may read them for the plan screen.
ALTER TABLE ai_top_up ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_top_up FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ai_top_up_system ON ai_top_up FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY ai_top_up_read ON ai_top_up FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
GRANT SELECT ON ai_top_up TO guidesk_app;
