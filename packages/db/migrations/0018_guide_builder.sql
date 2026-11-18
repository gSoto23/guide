CREATE TABLE "guide" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"has_unpublished_changes" boolean DEFAULT false NOT NULL,
	"published_version_id" uuid,
	"draft_state" text DEFAULT 'pending' NOT NULL,
	"completeness" smallint DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_status_valid" CHECK ("guide"."status" IN ('draft', 'published', 'unpublished')),
	CONSTRAINT "guide_draft_state_valid" CHECK ("guide"."draft_state" IN ('pending', 'drafting', 'ready', 'waiting_limit', 'failed')),
	CONSTRAINT "guide_completeness_range" CHECK ("guide"."completeness" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "guide_ai_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"guide_id" uuid,
	"kind" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd_micros" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_ai_request_kind_valid" CHECK ("guide_ai_request"."kind" IN ('draft_listing', 'interview_answer', 'document', 'translation')),
	CONSTRAINT "guide_ai_request_outcome_valid" CHECK ("guide_ai_request"."outcome" IN ('ok', 'refused', 'truncated', 'invalid', 'timeout', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "guide_document" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"guide_id" uuid NOT NULL,
	"file_name" text NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'checking' NOT NULL,
	"reject_reason" text,
	"pages" smallint,
	"scanned_pages" smallint,
	"text" text,
	"redactions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"suggestion_count" smallint DEFAULT 0 NOT NULL,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone,
	"text_deleted_at" timestamp with time zone,
	CONSTRAINT "guide_document_kind_valid" CHECK ("guide_document"."kind" IN ('pdf', 'photo')),
	CONSTRAINT "guide_document_status_valid" CHECK ("guide_document"."status" IN ('checking', 'reading', 'done', 'rejected')),
	CONSTRAINT "guide_document_file_name_length" CHECK (char_length("guide_document"."file_name") BETWEEN 1 AND 120),
	CONSTRAINT "guide_document_text_length" CHECK ("guide_document"."text" IS NULL OR char_length("guide_document"."text") <= 200000)
);
--> statement-breakpoint
CREATE TABLE "guide_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"section_id" uuid,
	"shared_block_id" uuid,
	"kind" text NOT NULL,
	"position" smallint NOT NULL,
	"source" text NOT NULL,
	"source_detail" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"source_language" text NOT NULL,
	"topics" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"fact_key" text,
	"media_id" uuid,
	"recommendation" jsonb,
	"code_warning_ack" text,
	"interview_turn_id" uuid,
	"document_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "guide_item_one_owner" CHECK (("guide_item"."section_id" IS NULL) <> ("guide_item"."shared_block_id" IS NULL)),
	CONSTRAINT "guide_item_kind_valid" CHECK ("guide_item"."kind" IN ('text', 'image', 'video', 'recommendation', 'fact')),
	CONSTRAINT "guide_item_source_valid" CHECK ("guide_item"."source" IN ('host', 'listing', 'pms', 'document', 'interview', 'copy')),
	CONSTRAINT "guide_item_language_valid" CHECK ("guide_item"."source_language" IN ('es', 'en')),
	CONSTRAINT "guide_item_source_detail_length" CHECK ("guide_item"."source_detail" IS NULL OR char_length("guide_item"."source_detail") <= 120),
	CONSTRAINT "guide_item_fact_key" CHECK (("guide_item"."kind" = 'fact') = ("guide_item"."fact_key" IS NOT NULL) AND ("guide_item"."fact_key" IS NULL OR "guide_item"."fact_key" IN ('check_in_time', 'checkout_time', 'max_guests', 'address'))),
	CONSTRAINT "guide_item_media" CHECK (("guide_item"."kind" IN ('image', 'video')) = ("guide_item"."media_id" IS NOT NULL)),
	CONSTRAINT "guide_item_recommendation" CHECK (("guide_item"."kind" = 'recommendation') = ("guide_item"."recommendation" IS NOT NULL)),
	CONSTRAINT "guide_item_host_reviewed" CHECK ("guide_item"."source" <> 'host' OR "guide_item"."reviewed_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "guide_item_text" (
	"item_id" uuid NOT NULL,
	"language" text NOT NULL,
	"workspace_id" uuid NOT NULL,
	"doc" jsonb,
	"text_length" integer DEFAULT 0 NOT NULL,
	"origin" text NOT NULL,
	"state" text DEFAULT 'current' NOT NULL,
	"source_hash" text,
	"pending_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_item_text_item_id_language_pk" PRIMARY KEY("item_id","language"),
	CONSTRAINT "guide_item_text_language_valid" CHECK ("guide_item_text"."language" IN ('es', 'en')),
	CONSTRAINT "guide_item_text_origin_valid" CHECK ("guide_item_text"."origin" IN ('source', 'machine', 'reviewed')),
	CONSTRAINT "guide_item_text_state_valid" CHECK ("guide_item_text"."state" IN ('current', 'stale', 'out_of_date', 'pending', 'failed')),
	CONSTRAINT "guide_item_text_pending_reason_valid" CHECK ("guide_item_text"."pending_reason" IS NULL OR "guide_item_text"."pending_reason" IN ('ai_limit', 'ai_unavailable', 'tokens_mismatch')),
	CONSTRAINT "guide_item_text_length_range" CHECK ("guide_item_text"."text_length" BETWEEN 0 AND 20000)
);
--> statement-breakpoint
CREATE TABLE "guide_section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"guide_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" jsonb,
	"position" smallint NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'missing' NOT NULL,
	"completeness" smallint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "guide_section_kind_valid" CHECK ("guide_section"."kind" IN ('arrival', 'wifi', 'house_rules', 'appliances', 'amenities', 'parking', 'local_recommendations', 'emergency', 'checkout', 'custom')),
	CONSTRAINT "guide_section_status_valid" CHECK ("guide_section"."status" IN ('missing', 'needs_review', 'ready')),
	CONSTRAINT "guide_section_title_custom_only" CHECK (("guide_section"."kind" = 'custom') = ("guide_section"."title" IS NOT NULL)),
	CONSTRAINT "guide_section_hidden_default_only" CHECK (NOT ("guide_section"."hidden" AND "guide_section"."kind" = 'custom')),
	CONSTRAINT "guide_section_completeness_range" CHECK ("guide_section"."completeness" IS NULL OR "guide_section"."completeness" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "guide_shared_link" (
	"guide_id" uuid NOT NULL,
	"shared_block_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"based_on_revision" integer,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_shared_link_guide_id_shared_block_id_pk" PRIMARY KEY("guide_id","shared_block_id"),
	CONSTRAINT "guide_shared_link_mode_valid" CHECK ("guide_shared_link"."mode" IN ('override', 'exclude'))
);
--> statement-breakpoint
CREATE TABLE "guide_topic_mark" (
	"guide_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"topic_id" text NOT NULL,
	"mark" text NOT NULL,
	"set_by" text,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_topic_mark_guide_id_topic_id_pk" PRIMARY KEY("guide_id","topic_id"),
	CONSTRAINT "guide_topic_mark_valid" CHECK ("guide_topic_mark"."mark" IN ('covered', 'not_applicable')),
	CONSTRAINT "guide_topic_mark_topic_length" CHECK (char_length("guide_topic_mark"."topic_id") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "guide_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"guide_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"cause" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"snapshot_schema" smallint NOT NULL,
	"languages" text[] NOT NULL,
	"published_by" text,
	"shared_block_id" uuid,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_version_cause_valid" CHECK ("guide_version"."cause" IN ('publish', 'shared_block', 'shared_block_removed')),
	CONSTRAINT "guide_version_number_positive" CHECK ("guide_version"."number" > 0)
);
--> statement-breakpoint
CREATE TABLE "interview_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"guide_id" uuid NOT NULL,
	"scope_section_kind" text,
	"status" text DEFAULT 'active' NOT NULL,
	"skipped_topics" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"started_by" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "interview_session_status_valid" CHECK ("interview_session"."status" IN ('active', 'finished')),
	CONSTRAINT "interview_session_scope_valid" CHECK ("interview_session"."scope_section_kind" IS NULL OR "interview_session"."scope_section_kind" IN ('arrival', 'wifi', 'house_rules', 'appliances', 'amenities', 'parking', 'local_recommendations', 'emergency', 'checkout'))
);
--> statement-breakpoint
CREATE TABLE "interview_turn" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"topic_id" text NOT NULL,
	"follow_up" text,
	"answer_kind" text NOT NULL,
	"answer_text" text,
	"transcript" text,
	"upload_id" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"redactions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"content_deleted_at" timestamp with time zone,
	CONSTRAINT "interview_turn_answer_kind_valid" CHECK ("interview_turn"."answer_kind" IN ('text', 'voice')),
	CONSTRAINT "interview_turn_status_valid" CHECK ("interview_turn"."status" IN ('queued', 'transcribing', 'drafting', 'done', 'failed')),
	CONSTRAINT "interview_turn_answer_length" CHECK ("interview_turn"."answer_text" IS NULL OR char_length("interview_turn"."answer_text") <= 2000),
	CONSTRAINT "interview_turn_follow_up_length" CHECK ("interview_turn"."follow_up" IS NULL OR char_length("interview_turn"."follow_up") <= 300),
	CONSTRAINT "interview_turn_topic_length" CHECK (char_length("interview_turn"."topic_id") BETWEEN 1 AND 60)
);
--> statement-breakpoint
CREATE TABLE "media_object" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	"object_prefix" text NOT NULL,
	"variants" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"bytes" bigint DEFAULT 0 NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"video_codec" text,
	"reject_reason" text,
	"upload_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unreferenced_since" timestamp with time zone,
	CONSTRAINT "media_object_kind_valid" CHECK ("media_object"."kind" IN ('image', 'video')),
	CONSTRAINT "media_object_status_valid" CHECK ("media_object"."status" IN ('uploading', 'processing', 'ready', 'rejected')),
	CONSTRAINT "media_object_codec_valid" CHECK ("media_object"."video_codec" IS NULL OR "media_object"."video_codec" IN ('h264', 'hevc')),
	CONSTRAINT "media_object_duration_range" CHECK ("media_object"."duration_ms" IS NULL OR "media_object"."duration_ms" BETWEEN 0 AND 90000),
	CONSTRAINT "media_object_bytes_range" CHECK ("media_object"."bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "shared_block" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"section_kind" text NOT NULL,
	"name" text NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"has_unpublished_changes" boolean DEFAULT false NOT NULL,
	"published_revision" integer,
	"published_snapshot" jsonb,
	"published_at" timestamp with time zone,
	"published_by" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_block_section_kind_valid" CHECK ("shared_block"."section_kind" IN ('arrival', 'wifi', 'house_rules', 'appliances', 'amenities', 'parking', 'local_recommendations', 'emergency', 'checkout')),
	CONSTRAINT "shared_block_status_valid" CHECK ("shared_block"."status" IN ('draft', 'published')),
	CONSTRAINT "shared_block_name_length" CHECK (char_length("shared_block"."name") BETWEEN 1 AND 80)
);
--> statement-breakpoint
ALTER TABLE "upload" DROP CONSTRAINT "upload_purpose_valid";--> statement-breakpoint
ALTER TABLE "upload" DROP CONSTRAINT "upload_declared_size_range";--> statement-breakpoint
ALTER TABLE "restricted_value" DROP CONSTRAINT "restricted_value_label_length";--> statement-breakpoint
ALTER TABLE "restricted_value" DROP CONSTRAINT "restricted_value_source_valid";--> statement-breakpoint
ALTER TABLE "restricted_value" DROP CONSTRAINT "restricted_value_source_field_length";--> statement-breakpoint
-- Labels become required (feature 003 data model §2): imported values without one get their kind's name.
UPDATE "restricted_value" SET "label" = CASE "kind"
  WHEN 'door_code' THEN 'Door code'
  WHEN 'gate_code' THEN 'Gate code'
  WHEN 'lockbox_code' THEN 'Lockbox code'
  WHEN 'alarm_code' THEN 'Alarm code'
  WHEN 'wifi_password' THEN 'Wi-Fi password'
  ELSE 'Code'
END WHERE "label" IS NULL;--> statement-breakpoint
ALTER TABLE "restricted_value" ALTER COLUMN "label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "restricted_value" ALTER COLUMN "value_ciphertext" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "restricted_value" ALTER COLUMN "data_key_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "restricted_value" ALTER COLUMN "source_field" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "upload" ADD COLUMN "media_object_id" uuid;--> statement-breakpoint
ALTER TABLE "upload" ADD COLUMN "guide_document_id" uuid;--> statement-breakpoint
ALTER TABLE "upload" ADD COLUMN "interview_turn_id" uuid;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "guide_ai_daily_limit" integer;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "media_storage_limit_mb" integer;--> statement-breakpoint
ALTER TABLE "restricted_value" ADD COLUMN "public_value" text;--> statement-breakpoint
ALTER TABLE "restricted_value" ADD COLUMN "section_kind" text DEFAULT 'arrival' NOT NULL;--> statement-breakpoint
ALTER TABLE "restricted_value" ADD COLUMN "value_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "restricted_value" ADD COLUMN "updated_by" text;--> statement-breakpoint
-- Imported values were set when they were imported; Wi-Fi passwords are listed in the Wi-Fi section.
UPDATE "restricted_value" SET "value_set_at" = "created_at",
  "section_kind" = CASE WHEN "kind" = 'wifi_password' THEN 'wifi' ELSE 'arrival' END;--> statement-breakpoint
ALTER TABLE "guide" ADD CONSTRAINT "guide_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide" ADD CONSTRAINT "guide_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide" ADD CONSTRAINT "guide_published_version_id_guide_version_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."guide_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide" ADD CONSTRAINT "guide_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_ai_request" ADD CONSTRAINT "guide_ai_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_ai_request" ADD CONSTRAINT "guide_ai_request_guide_id_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guide"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_document" ADD CONSTRAINT "guide_document_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_document" ADD CONSTRAINT "guide_document_guide_id_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guide"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_document" ADD CONSTRAINT "guide_document_uploaded_by_user_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_item" ADD CONSTRAINT "guide_item_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_item" ADD CONSTRAINT "guide_item_section_id_guide_section_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."guide_section"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_item" ADD CONSTRAINT "guide_item_shared_block_id_shared_block_id_fk" FOREIGN KEY ("shared_block_id") REFERENCES "public"."shared_block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_item" ADD CONSTRAINT "guide_item_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_item" ADD CONSTRAINT "guide_item_media_id_media_object_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_object"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_item" ADD CONSTRAINT "guide_item_interview_turn_id_interview_turn_id_fk" FOREIGN KEY ("interview_turn_id") REFERENCES "public"."interview_turn"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_item" ADD CONSTRAINT "guide_item_document_id_guide_document_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."guide_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_item" ADD CONSTRAINT "guide_item_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_item_text" ADD CONSTRAINT "guide_item_text_item_id_guide_item_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."guide_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_item_text" ADD CONSTRAINT "guide_item_text_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_section" ADD CONSTRAINT "guide_section_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_section" ADD CONSTRAINT "guide_section_guide_id_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guide"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_section" ADD CONSTRAINT "guide_section_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_shared_link" ADD CONSTRAINT "guide_shared_link_guide_id_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guide"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_shared_link" ADD CONSTRAINT "guide_shared_link_shared_block_id_shared_block_id_fk" FOREIGN KEY ("shared_block_id") REFERENCES "public"."shared_block"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_shared_link" ADD CONSTRAINT "guide_shared_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_shared_link" ADD CONSTRAINT "guide_shared_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_topic_mark" ADD CONSTRAINT "guide_topic_mark_guide_id_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guide"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_topic_mark" ADD CONSTRAINT "guide_topic_mark_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_topic_mark" ADD CONSTRAINT "guide_topic_mark_set_by_user_id_fk" FOREIGN KEY ("set_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_version" ADD CONSTRAINT "guide_version_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_version" ADD CONSTRAINT "guide_version_guide_id_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guide"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_version" ADD CONSTRAINT "guide_version_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_guide_id_guide_id_fk" FOREIGN KEY ("guide_id") REFERENCES "public"."guide"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_session" ADD CONSTRAINT "interview_session_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turn" ADD CONSTRAINT "interview_turn_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turn" ADD CONSTRAINT "interview_turn_session_id_interview_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."interview_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turn" ADD CONSTRAINT "interview_turn_upload_id_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."upload"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_turn" ADD CONSTRAINT "interview_turn_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object" ADD CONSTRAINT "media_object_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object" ADD CONSTRAINT "media_object_upload_id_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."upload"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_object" ADD CONSTRAINT "media_object_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_block" ADD CONSTRAINT "shared_block_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_block" ADD CONSTRAINT "shared_block_published_by_user_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_block" ADD CONSTRAINT "shared_block_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guide_property_uq" ON "guide" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "guide_workspace_idx" ON "guide" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "guide_ai_request_workspace_idx" ON "guide_ai_request" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "guide_document_guide_idx" ON "guide_document" USING btree ("guide_id","created_at");--> statement-breakpoint
CREATE INDEX "guide_document_workspace_idx" ON "guide_document" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "guide_item_section_idx" ON "guide_item" USING btree ("section_id","position");--> statement-breakpoint
CREATE INDEX "guide_item_shared_block_idx" ON "guide_item" USING btree ("shared_block_id","position");--> statement-breakpoint
CREATE INDEX "guide_item_workspace_idx" ON "guide_item" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "guide_item_media_idx" ON "guide_item" USING btree ("media_id");--> statement-breakpoint
CREATE INDEX "guide_item_document_idx" ON "guide_item" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "guide_item_text_workspace_idx" ON "guide_item_text" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "guide_item_text_stale_idx" ON "guide_item_text" USING btree ("state") WHERE "guide_item_text"."state" IN ('stale', 'pending');--> statement-breakpoint
CREATE UNIQUE INDEX "guide_section_kind_uq" ON "guide_section" USING btree ("guide_id","kind") WHERE "guide_section"."kind" <> 'custom';--> statement-breakpoint
CREATE INDEX "guide_section_guide_idx" ON "guide_section" USING btree ("guide_id","position");--> statement-breakpoint
CREATE INDEX "guide_section_workspace_idx" ON "guide_section" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "guide_shared_link_block_idx" ON "guide_shared_link" USING btree ("shared_block_id");--> statement-breakpoint
CREATE INDEX "guide_shared_link_workspace_idx" ON "guide_shared_link" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "guide_topic_mark_workspace_idx" ON "guide_topic_mark" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guide_version_number_uq" ON "guide_version" USING btree ("guide_id","number");--> statement-breakpoint
CREATE INDEX "guide_version_workspace_idx" ON "guide_version" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "interview_session_active_uq" ON "interview_session" USING btree ("guide_id") WHERE "interview_session"."status" = 'active';--> statement-breakpoint
CREATE INDEX "interview_session_workspace_idx" ON "interview_session" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "interview_turn_session_idx" ON "interview_turn" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "interview_turn_workspace_idx" ON "interview_turn" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "media_object_prefix_uq" ON "media_object" USING btree ("object_prefix");--> statement-breakpoint
CREATE INDEX "media_object_workspace_idx" ON "media_object" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "shared_block_workspace_idx" ON "shared_block" USING btree ("workspace_id","section_kind","position");--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_media_object_id_media_object_id_fk" FOREIGN KEY ("media_object_id") REFERENCES "public"."media_object"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_guide_document_id_guide_document_id_fk" FOREIGN KEY ("guide_document_id") REFERENCES "public"."guide_document"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_interview_turn_id_interview_turn_id_fk" FOREIGN KEY ("interview_turn_id") REFERENCES "public"."interview_turn"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_purpose_valid" CHECK ("upload"."purpose" IN ('screenshot', 'csv', 'document', 'photo', 'media', 'voice'));--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_declared_size_range" CHECK ("upload"."declared_size" > 0 AND "upload"."declared_size" <= CASE "upload"."purpose" WHEN 'media' THEN 157286400 WHEN 'document' THEN 20971520 ELSE 10485760 END);--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_guide_ai_daily_limit_positive" CHECK ("workspace"."guide_ai_daily_limit" IS NULL OR "workspace"."guide_ai_daily_limit" > 0);--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_media_storage_limit_positive" CHECK ("workspace"."media_storage_limit_mb" IS NULL OR "workspace"."media_storage_limit_mb" > 0);--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_pms_source_field" CHECK ("restricted_value"."source" <> 'pms' OR "restricted_value"."source_field" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_section_kind_valid" CHECK ("restricted_value"."section_kind" IN ('arrival', 'wifi', 'house_rules', 'appliances', 'amenities', 'parking', 'local_recommendations', 'emergency', 'checkout'));--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_key_with_value" CHECK (("restricted_value"."value_ciphertext" IS NULL) = ("restricted_value"."data_key_id" IS NULL));--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_public_or_secret" CHECK ("restricted_value"."public_value" IS NULL OR "restricted_value"."value_ciphertext" IS NULL);--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_public_wifi_only" CHECK ("restricted_value"."public_value" IS NULL OR ("restricted_value"."kind" = 'wifi_password' AND char_length("restricted_value"."public_value") BETWEEN 1 AND 200));--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_label_length" CHECK (char_length("restricted_value"."label") BETWEEN 1 AND 80);--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_source_valid" CHECK ("restricted_value"."source" IN ('pms', 'host', 'copy'));--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_source_field_length" CHECK ("restricted_value"."source_field" IS NULL OR char_length("restricted_value"."source_field") BETWEEN 1 AND 80);