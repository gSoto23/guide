CREATE TABLE "plan_usage_notice" (
	"workspace_id" uuid NOT NULL,
	"month" date NOT NULL,
	"threshold" smallint NOT NULL,
	"notified_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_usage_notice_workspace_id_month_threshold_pk" PRIMARY KEY("workspace_id","month","threshold"),
	CONSTRAINT "plan_usage_notice_threshold_valid" CHECK ("plan_usage_notice"."threshold" IN (80, 100))
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "plan" text DEFAULT 'free' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "plan_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "plan_note" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "ai_reply_monthly_limit" integer;--> statement-breakpoint
ALTER TABLE "plan_usage_notice" ADD CONSTRAINT "plan_usage_notice_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_plan_valid" CHECK ("workspace"."plan" IN ('free', 'pro', 'business'));--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_plan_note_length" CHECK ("workspace"."plan_note" IS NULL OR char_length("workspace"."plan_note") BETWEEN 1 AND 200);--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_ai_reply_monthly_limit_positive" CHECK ("workspace"."ai_reply_monthly_limit" IS NULL OR "workspace"."ai_reply_monthly_limit" > 0);--> statement-breakpoint
-- Feature 011 (data model): threshold notices are system only (the worker); members have no access.
ALTER TABLE plan_usage_notice ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE plan_usage_notice FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY plan_usage_notice_system ON plan_usage_notice FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
