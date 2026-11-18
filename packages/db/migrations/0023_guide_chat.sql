CREATE TABLE "agent_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"trace_id" uuid,
	"body" text NOT NULL,
	"section_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"acted_by" text,
	"acted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_draft_status_valid" CHECK ("agent_draft"."status" IN ('open', 'sent', 'edited', 'superseded', 'discarded')),
	CONSTRAINT "agent_draft_body_length" CHECK (char_length("agent_draft"."body") BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "agent_trace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"guest_message_id" uuid,
	"reply_message_id" uuid,
	"classification" jsonb,
	"decision" text NOT NULL,
	"reason" text,
	"autonomy" text NOT NULL,
	"guide_version_id" uuid,
	"section_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"sent_by" text,
	"edited" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_trace_decision_valid" CHECK ("agent_trace"."decision" IN ('answered', 'drafted', 'held', 'pointer', 'greeting', 'paused'))
);
--> statement-breakpoint
CREATE TABLE "chat_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"author" text NOT NULL,
	"kind" text DEFAULT 'text' NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb,
	"author_user_id" text,
	"client_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_message_body_length" CHECK (char_length("chat_message"."body") BETWEEN 1 AND 4000),
	CONSTRAINT "chat_message_author_valid" CHECK ("chat_message"."author" IN ('guest', 'assistant', 'host')),
	CONSTRAINT "chat_message_kind_valid" CHECK ("chat_message"."kind" IN ('text', 'holding', 'emergency', 'pointer', 'greeting', 'pause'))
);
--> statement-breakpoint
CREATE TABLE "chat_usage_daily" (
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"day" date NOT NULL,
	"replies" integer DEFAULT 0 NOT NULL,
	"cost_usd_micros" bigint DEFAULT 0 NOT NULL,
	"limit_notified_at" timestamp with time zone,
	CONSTRAINT "chat_usage_daily_property_id_day_pk" PRIMARY KEY("property_id","day")
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid,
	"cookie_hash" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"needs_host_reason" text,
	"language" text NOT NULL,
	"last_message_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_cookie_hash_format" CHECK ("conversation"."cookie_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "conversation_status_valid" CHECK ("conversation"."status" IN ('open', 'needs_host')),
	CONSTRAINT "conversation_reason_consistent" CHECK (("conversation"."status" = 'needs_host') = ("conversation"."needs_host_reason" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "assistant_autonomy" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "chat_daily_limit" integer DEFAULT 1000 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "chat_property_daily_limit" integer DEFAULT 200 NOT NULL;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "assistant_autonomy" text;--> statement-breakpoint
ALTER TABLE "agent_draft" ADD CONSTRAINT "agent_draft_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_draft" ADD CONSTRAINT "agent_draft_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_draft" ADD CONSTRAINT "agent_draft_trace_id_agent_trace_id_fk" FOREIGN KEY ("trace_id") REFERENCES "public"."agent_trace"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_draft" ADD CONSTRAINT "agent_draft_acted_by_user_id_fk" FOREIGN KEY ("acted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_guest_message_id_chat_message_id_fk" FOREIGN KEY ("guest_message_id") REFERENCES "public"."chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_reply_message_id_chat_message_id_fk" FOREIGN KEY ("reply_message_id") REFERENCES "public"."chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_guide_version_id_guide_version_id_fk" FOREIGN KEY ("guide_version_id") REFERENCES "public"."guide_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trace" ADD CONSTRAINT "agent_trace_sent_by_user_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_conversation_id_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_author_user_id_user_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_usage_daily" ADD CONSTRAINT "chat_usage_daily_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_usage_daily" ADD CONSTRAINT "chat_usage_daily_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation" ADD CONSTRAINT "conversation_stay_id_stay_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stay"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_draft_open_uq" ON "agent_draft" USING btree ("conversation_id") WHERE "agent_draft"."status" = 'open';--> statement-breakpoint
CREATE INDEX "agent_draft_workspace_idx" ON "agent_draft" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "agent_trace_conversation_idx" ON "agent_trace" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "agent_trace_created_idx" ON "agent_trace" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_seq_uq" ON "chat_message" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_client_uq" ON "chat_message" USING btree ("conversation_id","client_id") WHERE "chat_message"."client_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_message_workspace_idx" ON "chat_message" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "chat_usage_daily_workspace_idx" ON "chat_usage_daily" USING btree ("workspace_id","day");--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_device_uq" ON "conversation" USING btree ("property_id","cookie_hash");--> statement-breakpoint
CREATE INDEX "conversation_property_status_idx" ON "conversation" USING btree ("property_id","status","last_message_at");--> statement-breakpoint
CREATE INDEX "conversation_workspace_idx" ON "conversation" USING btree ("workspace_id");