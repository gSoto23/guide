CREATE TABLE "assistant_contact" (
	"settings_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	CONSTRAINT "assistant_contact_settings_id_membership_id_pk" PRIMARY KEY("settings_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "assistant_instruction_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid,
	"text" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_instruction_version_text_len" CHECK (char_length("assistant_instruction_version"."text") BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "assistant_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid,
	"autonomy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tone" text DEFAULT 'casual' NOT NULL,
	"quiet_enabled" boolean DEFAULT false NOT NULL,
	"quiet_start" time,
	"quiet_end" time,
	"contacts_mode" text DEFAULT 'all' NOT NULL,
	"own_groups" text[] DEFAULT '{}'::text[] NOT NULL,
	"instruction_version_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "assistant_settings_scope_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","property_id"),
	CONSTRAINT "assistant_settings_tone_valid" CHECK ("assistant_settings"."tone" IN ('casual', 'formal')),
	CONSTRAINT "assistant_settings_contacts_mode_valid" CHECK ("assistant_settings"."contacts_mode" IN ('all', 'selected')),
	CONSTRAINT "assistant_settings_own_groups_valid" CHECK ("assistant_settings"."own_groups" <@ ARRAY['autonomy','tone','quiet_hours','contacts']::text[]),
	CONSTRAINT "assistant_settings_quiet_valid" CHECK (NOT "assistant_settings"."quiet_enabled" OR ("assistant_settings"."quiet_start" IS NOT NULL AND "assistant_settings"."quiet_end" IS NOT NULL AND "assistant_settings"."quiet_start" <> "assistant_settings"."quiet_end"))
);
--> statement-breakpoint
CREATE TABLE "assistant_test" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"created_by" text NOT NULL,
	"question" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"outcome" text,
	"reason" text,
	"topic" text,
	"answer_kind" text,
	"reply" text,
	"section_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "assistant_test_question_len" CHECK (char_length("assistant_test"."question") BETWEEN 1 AND 2000),
	CONSTRAINT "assistant_test_status_valid" CHECK ("assistant_test"."status" IN ('pending', 'done'))
);
--> statement-breakpoint
CREATE TABLE "chat_held_notice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"reason" text NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_trace" ALTER COLUMN "conversation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD COLUMN "assistant_test_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD COLUMN "autonomy_source" text;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD COLUMN "answer_kind" text;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD COLUMN "tone" text;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD COLUMN "quiet_hours" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD COLUMN "workspace_instruction_version_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD COLUMN "property_instruction_version_id" uuid;--> statement-breakpoint
ALTER TABLE "assistant_contact" ADD CONSTRAINT "assistant_contact_settings_id_assistant_settings_id_fk" FOREIGN KEY ("settings_id") REFERENCES "public"."assistant_settings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_contact" ADD CONSTRAINT "assistant_contact_membership_id_membership_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."membership"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_contact" ADD CONSTRAINT "assistant_contact_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_instruction_version" ADD CONSTRAINT "assistant_instruction_version_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_instruction_version" ADD CONSTRAINT "assistant_instruction_version_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_instruction_version" ADD CONSTRAINT "assistant_instruction_version_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_instruction_version_id_assistant_instruction_version_id_fk" FOREIGN KEY ("instruction_version_id") REFERENCES "public"."assistant_instruction_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_test" ADD CONSTRAINT "assistant_test_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_test" ADD CONSTRAINT "assistant_test_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_test" ADD CONSTRAINT "assistant_test_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_held_notice" ADD CONSTRAINT "chat_held_notice_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_held_notice" ADD CONSTRAINT "chat_held_notice_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_held_notice" ADD CONSTRAINT "chat_held_notice_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_held_notice" ADD CONSTRAINT "chat_held_notice_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assistant_contact_membership_idx" ON "assistant_contact" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "assistant_instruction_version_scope_idx" ON "assistant_instruction_version" USING btree ("workspace_id","property_id");--> statement-breakpoint
CREATE INDEX "assistant_test_property_idx" ON "assistant_test" USING btree ("property_id","created_at");--> statement-breakpoint
CREATE INDEX "assistant_test_created_idx" ON "assistant_test" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_held_notice_uq" ON "chat_held_notice" USING btree ("conversation_id","user_id");--> statement-breakpoint
CREATE INDEX "chat_held_notice_release_idx" ON "chat_held_notice" USING btree ("release_at");--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_assistant_test_id_assistant_test_id_fk" FOREIGN KEY ("assistant_test_id") REFERENCES "public"."assistant_test"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_workspace_instruction_version_id_assistant_instruction_version_id_fk" FOREIGN KEY ("workspace_instruction_version_id") REFERENCES "public"."assistant_instruction_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_property_instruction_version_id_assistant_instruction_version_id_fk" FOREIGN KEY ("property_instruction_version_id") REFERENCES "public"."assistant_instruction_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_trace_test_idx" ON "agent_trace" USING btree ("assistant_test_id");--> statement-breakpoint
-- Feature 007 research R9: every topic takes spec 005's mode, so nothing changes for guests.
INSERT INTO "assistant_settings" ("workspace_id", "property_id", "autonomy")
SELECT w."id", NULL, (SELECT jsonb_object_agg(t, w."assistant_autonomy") FROM unnest(ARRAY['arrival','wifi','house_rules','appliances','amenities','parking','local_recommendations','emergency','checkout','other']) AS t)
FROM "workspace" w
WHERE w."assistant_autonomy" <> 'draft';--> statement-breakpoint
INSERT INTO "assistant_settings" ("workspace_id", "property_id", "autonomy", "own_groups")
SELECT p."workspace_id", p."id", (SELECT jsonb_object_agg(t, p."assistant_autonomy") FROM unnest(ARRAY['arrival','wifi','house_rules','appliances','amenities','parking','local_recommendations','emergency','checkout','other']) AS t), ARRAY['autonomy']::text[]
FROM "property" p
WHERE p."assistant_autonomy" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" DROP COLUMN "assistant_autonomy";--> statement-breakpoint
ALTER TABLE "property" DROP COLUMN "assistant_autonomy";--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_subject" CHECK (("agent_trace"."conversation_id" IS NULL) <> ("agent_trace"."assistant_test_id" IS NULL));