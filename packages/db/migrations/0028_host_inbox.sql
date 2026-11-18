CREATE TABLE "conversation_presence" (
	"conversation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "conversation_presence_conversation_id_user_id_pk" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "assistant_suggestion_dismissal" (
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"dismissed_until" timestamp with time zone NOT NULL,
	"dismissed_by" text,
	CONSTRAINT "assistant_suggestion_dismissal_property_id_topic_pk" PRIMARY KEY("property_id","topic")
);
--> statement-breakpoint
CREATE TABLE "copilot_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"message" text NOT NULL,
	"booking_status" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"draft" text,
	"section_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"removed" text[] DEFAULT '{}'::text[] NOT NULL,
	"caution" text,
	"covered" boolean,
	"topic" text,
	"answer_kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "copilot_run_message_len" CHECK (char_length("copilot_run"."message") BETWEEN 1 AND 4000),
	CONSTRAINT "copilot_run_booking_valid" CHECK ("copilot_run"."booking_status" IN ('inquiry', 'confirmed')),
	CONSTRAINT "copilot_run_status_valid" CHECK ("copilot_run"."status" IN ('pending', 'done'))
);
--> statement-breakpoint
CREATE TABLE "push_subscription" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"device" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_success_at" timestamp with time zone,
	CONSTRAINT "push_subscription_endpoint_https" CHECK ("push_subscription"."endpoint" LIKE 'https://%' AND char_length("push_subscription"."endpoint") <= 2048),
	CONSTRAINT "push_subscription_device_len" CHECK (char_length("push_subscription"."device") BETWEEN 1 AND 60)
);
--> statement-breakpoint
ALTER TABLE "agent_trace" DROP CONSTRAINT "agent_trace_subject";--> statement-breakpoint
ALTER TABLE "conversation" DROP CONSTRAINT "conversation_status_valid";--> statement-breakpoint
ALTER TABLE "agent_trace" ADD COLUMN "copilot_run_id" uuid;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "done_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "done_by" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "taken_over_by" text;--> statement-breakpoint
ALTER TABLE "conversation" ADD COLUMN "taken_over_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "conversation_presence" ADD CONSTRAINT "conversation_presence_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_presence" ADD CONSTRAINT "conversation_presence_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_presence" ADD CONSTRAINT "conversation_presence_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_suggestion_dismissal" ADD CONSTRAINT "assistant_suggestion_dismissal_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_suggestion_dismissal" ADD CONSTRAINT "assistant_suggestion_dismissal_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_suggestion_dismissal" ADD CONSTRAINT "assistant_suggestion_dismissal_dismissed_by_user_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_run" ADD CONSTRAINT "copilot_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_run" ADD CONSTRAINT "copilot_run_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copilot_run" ADD CONSTRAINT "copilot_run_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_presence_workspace_idx" ON "conversation_presence" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE INDEX "copilot_run_property_idx" ON "copilot_run" USING btree ("property_id","created_at");--> statement-breakpoint
CREATE INDEX "copilot_run_created_idx" ON "copilot_run" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_subscription_endpoint_uq" ON "push_subscription" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "push_subscription_user_idx" ON "push_subscription" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_copilot_run_id_copilot_run_id_fk" FOREIGN KEY ("copilot_run_id") REFERENCES "public"."copilot_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_taken_over_by_user_id_fk" FOREIGN KEY ("taken_over_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_trace_copilot_idx" ON "agent_trace" USING btree ("copilot_run_id");--> statement-breakpoint
CREATE INDEX "conversation_inbox_idx" ON "conversation" USING btree ("workspace_id","status","last_message_at");--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_subject" CHECK ((CASE WHEN "agent_trace"."conversation_id" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "agent_trace"."assistant_test_id" IS NULL THEN 0 ELSE 1 END) + (CASE WHEN "agent_trace"."copilot_run_id" IS NULL THEN 0 ELSE 1 END) = 1);--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_done_consistent" CHECK (("conversation"."status" = 'done') = ("conversation"."done_at" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_status_valid" CHECK ("conversation"."status" IN ('open', 'needs_host', 'done'));