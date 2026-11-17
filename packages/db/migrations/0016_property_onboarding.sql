CREATE TABLE "extraction_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid,
	"status" text NOT NULL,
	"input_text" text,
	"recognized_text" text,
	"screenshot_count" smallint DEFAULT 0 NOT NULL,
	"redactions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"url_only" boolean DEFAULT false NOT NULL,
	"retry_of_id" uuid,
	"result" jsonb,
	"failed_screenshots" smallint DEFAULT 0 NOT NULL,
	"error_code" text,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd_micros" integer,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"input_deleted_at" timestamp with time zone,
	CONSTRAINT "extraction_request_status_valid" CHECK ("extraction_request"."status" IN ('awaiting_uploads', 'queued', 'running', 'succeeded', 'failed')),
	CONSTRAINT "extraction_request_input_length" CHECK ("extraction_request"."input_text" IS NULL OR char_length("extraction_request"."input_text") <= 20000),
	CONSTRAINT "extraction_request_screenshot_count_range" CHECK ("extraction_request"."screenshot_count" BETWEEN 0 AND 10 AND "extraction_request"."failed_screenshots" BETWEEN 0 AND "extraction_request"."screenshot_count"),
	CONSTRAINT "extraction_request_error_code_length" CHECK ("extraction_request"."error_code" IS NULL OR char_length("extraction_request"."error_code") <= 40)
);
--> statement-breakpoint
CREATE TABLE "upload" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"object_key" text NOT NULL,
	"declared_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"extraction_request_id" uuid,
	"import_run_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone DEFAULT now() + interval '24 hours' NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "upload_purpose_valid" CHECK ("upload"."purpose" IN ('screenshot', 'csv')),
	CONSTRAINT "upload_status_valid" CHECK ("upload"."status" IN ('pending', 'received', 'processed', 'rejected', 'deleted')),
	CONSTRAINT "upload_declared_size_range" CHECK ("upload"."declared_size" > 0 AND "upload"."declared_size" <= 10485760),
	CONSTRAINT "upload_declared_type_length" CHECK (char_length("upload"."declared_type") BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "import_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"import_run_id" uuid NOT NULL,
	"row_number" integer,
	"external_id" text,
	"label" text NOT NULL,
	"selected" boolean DEFAULT true NOT NULL,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"reason_code" text,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"row_values" jsonb,
	"calendar_url_ciphertext" "bytea",
	"data_key_id" uuid,
	"property_id" uuid,
	CONSTRAINT "import_item_outcome_valid" CHECK ("import_item"."outcome" IN ('pending', 'created', 'updated', 'needs_details', 'failed', 'skipped')),
	CONSTRAINT "import_item_label_length" CHECK (char_length("import_item"."label") BETWEEN 1 AND 120),
	CONSTRAINT "import_item_reason_length" CHECK ("import_item"."reason_code" IS NULL OR char_length("import_item"."reason_code") <= 40),
	CONSTRAINT "import_item_calendar_key" CHECK ("import_item"."calendar_url_ciphertext" IS NULL OR "import_item"."data_key_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "import_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"pms_connection_id" uuid,
	"upload_id" uuid,
	"status" text NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"created" integer DEFAULT 0 NOT NULL,
	"needs_details" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"skipped" integer DEFAULT 0 NOT NULL,
	"started_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	CONSTRAINT "import_run_kind_valid" CHECK ("import_run"."kind" IN ('pms', 'csv')),
	CONSTRAINT "import_run_status_valid" CHECK ("import_run"."status" IN ('validating', 'awaiting_confirmation', 'running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "import_run_counts" CHECK ("import_run"."total" >= 0 AND "import_run"."processed" BETWEEN 0 AND "import_run"."total"
        AND "import_run"."created" >= 0 AND "import_run"."needs_details" >= 0 AND "import_run"."failed" >= 0 AND "import_run"."skipped" >= 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_data_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"wrapped_key" "bytea" NOT NULL,
	"kms_key_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_data_key_status_valid" CHECK ("workspace_data_key"."status" IN ('active', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "listing_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text,
	"items" text[],
	"language" text,
	"source" text NOT NULL,
	"review_state" text DEFAULT 'unreviewed' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"extraction_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "listing_content_kind_valid" CHECK ("listing_content"."kind" IN ('title', 'description', 'house_rules', 'amenities')),
	CONSTRAINT "listing_content_body_length" CHECK ("listing_content"."body" IS NULL OR char_length("listing_content"."body") <= 20000),
	CONSTRAINT "listing_content_items_count" CHECK ("listing_content"."items" IS NULL OR cardinality("listing_content"."items") <= 200),
	CONSTRAINT "listing_content_language_length" CHECK ("listing_content"."language" IS NULL OR char_length("listing_content"."language") <= 35),
	CONSTRAINT "listing_content_source_valid" CHECK ("listing_content"."source" IN ('listing_text', 'screenshot', 'pms', 'duplicate')),
	CONSTRAINT "listing_content_review_state_valid" CHECK ("listing_content"."review_state" IN ('unreviewed', 'edited', 'approved'))
);
--> statement-breakpoint
CREATE TABLE "property" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address_line1" text,
	"address_unit" text,
	"city" text,
	"region" text,
	"postal_code" text,
	"country" char(2),
	"address_key" text,
	"time_zone" text,
	"check_in_time" time,
	"checkout_time" time,
	"max_guests" smallint,
	"guide_languages" text[] NOT NULL,
	"setup_status" text NOT NULL,
	"missing_facts" text[] DEFAULT '{}'::text[] NOT NULL,
	"edited_facts" text[] DEFAULT '{}'::text[] NOT NULL,
	"source" text NOT NULL,
	"source_provider" text,
	"pms_connection_id" uuid,
	"external_id" text,
	"pms_status" text,
	"duplicated_from_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" text,
	"purge_after" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_name_length" CHECK (char_length("property"."name") BETWEEN 1 AND 120),
	CONSTRAINT "property_address_line1_length" CHECK ("property"."address_line1" IS NULL OR char_length("property"."address_line1") BETWEEN 1 AND 200),
	CONSTRAINT "property_address_parts_length" CHECK (("property"."address_unit" IS NULL OR char_length("property"."address_unit") <= 100)
        AND ("property"."region" IS NULL OR char_length("property"."region") <= 120)
        AND ("property"."postal_code" IS NULL OR char_length("property"."postal_code") <= 20)),
	CONSTRAINT "property_city_length" CHECK ("property"."city" IS NULL OR char_length("property"."city") BETWEEN 1 AND 120),
	CONSTRAINT "property_country_valid" CHECK ("property"."country" IS NULL OR "property"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "property_max_guests_range" CHECK ("property"."max_guests" IS NULL OR "property"."max_guests" BETWEEN 1 AND 50),
	CONSTRAINT "property_guide_languages_valid" CHECK (cardinality("property"."guide_languages") >= 1 AND "property"."guide_languages" <@ ARRAY['es', 'en']::text[]),
	CONSTRAINT "property_setup_status_valid" CHECK ("property"."setup_status" IN ('needs_details', 'to_confirm', 'ready')),
	CONSTRAINT "property_source_valid" CHECK ("property"."source" IN ('manual', 'listing_text', 'csv', 'pms', 'duplicate')),
	CONSTRAINT "property_source_provider_valid" CHECK (("property"."source_provider" IS NULL AND "property"."source" <> 'pms')
        OR ("property"."source_provider" IN ('beds24', 'hostex') AND "property"."source" = 'pms')),
	CONSTRAINT "property_pms_status_valid" CHECK ("property"."pms_status" IS NULL OR "property"."pms_status" IN ('linked', 'not_found')),
	CONSTRAINT "property_status_valid" CHECK ("property"."status" IN ('active', 'removed')),
	CONSTRAINT "property_removed_fields" CHECK (("property"."status" = 'active' AND "property"."removed_at" IS NULL AND "property"."purge_after" IS NULL)
        OR ("property"."status" = 'removed' AND "property"."removed_at" IS NOT NULL AND "property"."purge_after" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "restricted_value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"value_ciphertext" "bytea" NOT NULL,
	"data_key_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_field" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restricted_value_kind_valid" CHECK ("restricted_value"."kind" IN ('door_code', 'gate_code', 'lockbox_code', 'alarm_code', 'wifi_password', 'other')),
	CONSTRAINT "restricted_value_label_length" CHECK ("restricted_value"."label" IS NULL OR char_length("restricted_value"."label") <= 80),
	CONSTRAINT "restricted_value_source_valid" CHECK ("restricted_value"."source" = 'pms'),
	CONSTRAINT "restricted_value_source_field_length" CHECK (char_length("restricted_value"."source_field") BETWEEN 1 AND 80)
);
--> statement-breakpoint
CREATE TABLE "calendar_feed" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"channel_label" text,
	"url_ciphertext" "bytea" NOT NULL,
	"url_fingerprint" text NOT NULL,
	"display_hint" text NOT NULL,
	"data_key_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_attempt_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"alerted_at" timestamp with time zone,
	"last_error_code" text,
	"etag" text,
	"last_modified" text,
	"manual_refresh_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calendar_feed_channel_valid" CHECK ("calendar_feed"."channel" IN ('airbnb', 'booking', 'vrbo', 'other')),
	CONSTRAINT "calendar_feed_channel_label" CHECK (("calendar_feed"."channel" <> 'other' OR "calendar_feed"."channel_label" IS NOT NULL)
        AND ("calendar_feed"."channel_label" IS NULL OR char_length("calendar_feed"."channel_label") BETWEEN 1 AND 40)),
	CONSTRAINT "calendar_feed_status_valid" CHECK ("calendar_feed"."status" IN ('active', 'failing')),
	CONSTRAINT "calendar_feed_error_code_length" CHECK ("calendar_feed"."last_error_code" IS NULL OR char_length("calendar_feed"."last_error_code") <= 40)
);
--> statement-breakpoint
CREATE TABLE "stay" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"source" text NOT NULL,
	"calendar_feed_id" uuid,
	"pms_connection_id" uuid,
	"external_uid" text,
	"check_in_date" date NOT NULL,
	"checkout_date" date NOT NULL,
	"check_in_time" time,
	"checkout_time" time,
	"channel" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"may_be_block" boolean DEFAULT false NOT NULL,
	"guest_count" smallint,
	"guest_name" text,
	"guest_name_removed_at" timestamp with time zone,
	"booking_reference" text,
	"duplicate_of_id" uuid,
	"overlaps" boolean DEFAULT false NOT NULL,
	"last_seen_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "stay_dates_order" CHECK ("stay"."checkout_date" > "stay"."check_in_date"),
	CONSTRAINT "stay_source_valid" CHECK ("stay"."source" IN ('ical', 'pms', 'manual')),
	CONSTRAINT "stay_status_valid" CHECK ("stay"."status" IN ('active', 'cancelled', 'hidden')),
	CONSTRAINT "stay_source_links" CHECK (("stay"."source" = 'ical' AND "stay"."calendar_feed_id" IS NOT NULL AND "stay"."external_uid" IS NOT NULL)
        OR ("stay"."source" = 'pms' AND "stay"."calendar_feed_id" IS NULL AND "stay"."external_uid" IS NOT NULL)
        OR ("stay"."source" = 'manual' AND "stay"."calendar_feed_id" IS NULL AND "stay"."pms_connection_id" IS NULL)),
	CONSTRAINT "stay_channel_length" CHECK (char_length("stay"."channel") BETWEEN 1 AND 40),
	CONSTRAINT "stay_guest_fields" CHECK (("stay"."guest_name" IS NULL OR char_length("stay"."guest_name") <= 120)
        AND ("stay"."guest_count" IS NULL OR "stay"."guest_count" BETWEEN 0 AND 500)
        AND ("stay"."booking_reference" IS NULL OR char_length("stay"."booking_reference") <= 80)),
	CONSTRAINT "stay_ical_no_guest_data" CHECK ("stay"."source" <> 'ical' OR ("stay"."guest_name" IS NULL AND "stay"."guest_count" IS NULL AND "stay"."booking_reference" IS NULL)),
	CONSTRAINT "stay_guest_name_removed" CHECK ("stay"."guest_name_removed_at" IS NULL OR "stay"."guest_name" IS NULL)
);
--> statement-breakpoint
CREATE TABLE "pms_connection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_account_id" text NOT NULL,
	"account_label" text NOT NULL,
	"credential_ciphertext" "bytea",
	"data_key_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"last_refresh_at" timestamp with time zone,
	"failing_since" timestamp with time zone,
	"alerted_at" timestamp with time zone,
	"manual_refresh_at" timestamp with time zone,
	"last_error_code" text,
	"connected_by" text,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disconnected_by" text,
	"disconnected_at" timestamp with time zone,
	CONSTRAINT "pms_connection_provider_valid" CHECK ("pms_connection"."provider" IN ('beds24', 'hostex')),
	CONSTRAINT "pms_connection_status_valid" CHECK ("pms_connection"."status" IN ('active', 'failing', 'disconnected')),
	CONSTRAINT "pms_connection_label_length" CHECK (char_length("pms_connection"."account_label") BETWEEN 1 AND 80 AND char_length("pms_connection"."external_account_id") BETWEEN 1 AND 120),
	CONSTRAINT "pms_connection_credential_state" CHECK (("pms_connection"."status" = 'disconnected' AND "pms_connection"."credential_ciphertext" IS NULL AND "pms_connection"."disconnected_at" IS NOT NULL)
        OR ("pms_connection"."status" <> 'disconnected' AND "pms_connection"."credential_ciphertext" IS NOT NULL AND "pms_connection"."data_key_id" IS NOT NULL)),
	CONSTRAINT "pms_connection_error_code_length" CHECK ("pms_connection"."last_error_code" IS NULL OR char_length("pms_connection"."last_error_code") <= 40)
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "property_limit" integer;--> statement-breakpoint
ALTER TABLE "extraction_request" ADD CONSTRAINT "extraction_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_request" ADD CONSTRAINT "extraction_request_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_request" ADD CONSTRAINT "extraction_request_retry_of_id_extraction_request_id_fk" FOREIGN KEY ("retry_of_id") REFERENCES "public"."extraction_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extraction_request" ADD CONSTRAINT "extraction_request_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_extraction_request_id_extraction_request_id_fk" FOREIGN KEY ("extraction_request_id") REFERENCES "public"."extraction_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload" ADD CONSTRAINT "upload_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_item" ADD CONSTRAINT "import_item_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_item" ADD CONSTRAINT "import_item_import_run_id_import_run_id_fk" FOREIGN KEY ("import_run_id") REFERENCES "public"."import_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_item" ADD CONSTRAINT "import_item_data_key_id_workspace_data_key_id_fk" FOREIGN KEY ("data_key_id") REFERENCES "public"."workspace_data_key"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_item" ADD CONSTRAINT "import_item_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_pms_connection_id_pms_connection_id_fk" FOREIGN KEY ("pms_connection_id") REFERENCES "public"."pms_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_upload_id_upload_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."upload"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_run" ADD CONSTRAINT "import_run_started_by_user_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_data_key" ADD CONSTRAINT "workspace_data_key_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_content" ADD CONSTRAINT "listing_content_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_content" ADD CONSTRAINT "listing_content_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_content" ADD CONSTRAINT "listing_content_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "listing_content" ADD CONSTRAINT "listing_content_extraction_request_id_extraction_request_id_fk" FOREIGN KEY ("extraction_request_id") REFERENCES "public"."extraction_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_pms_connection_id_pms_connection_id_fk" FOREIGN KEY ("pms_connection_id") REFERENCES "public"."pms_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_duplicated_from_id_property_id_fk" FOREIGN KEY ("duplicated_from_id") REFERENCES "public"."property"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_removed_by_user_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restricted_value" ADD CONSTRAINT "restricted_value_data_key_id_workspace_data_key_id_fk" FOREIGN KEY ("data_key_id") REFERENCES "public"."workspace_data_key"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feed" ADD CONSTRAINT "calendar_feed_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feed" ADD CONSTRAINT "calendar_feed_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feed" ADD CONSTRAINT "calendar_feed_data_key_id_workspace_data_key_id_fk" FOREIGN KEY ("data_key_id") REFERENCES "public"."workspace_data_key"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_feed" ADD CONSTRAINT "calendar_feed_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay" ADD CONSTRAINT "stay_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay" ADD CONSTRAINT "stay_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay" ADD CONSTRAINT "stay_calendar_feed_id_calendar_feed_id_fk" FOREIGN KEY ("calendar_feed_id") REFERENCES "public"."calendar_feed"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay" ADD CONSTRAINT "stay_pms_connection_id_pms_connection_id_fk" FOREIGN KEY ("pms_connection_id") REFERENCES "public"."pms_connection"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay" ADD CONSTRAINT "stay_duplicate_of_id_stay_id_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."stay"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay" ADD CONSTRAINT "stay_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_connection" ADD CONSTRAINT "pms_connection_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_connection" ADD CONSTRAINT "pms_connection_data_key_id_workspace_data_key_id_fk" FOREIGN KEY ("data_key_id") REFERENCES "public"."workspace_data_key"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_connection" ADD CONSTRAINT "pms_connection_connected_by_user_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_connection" ADD CONSTRAINT "pms_connection_disconnected_by_user_id_fk" FOREIGN KEY ("disconnected_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extraction_request_workspace_idx" ON "extraction_request" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "extraction_request_retention_idx" ON "extraction_request" USING btree ("created_at") WHERE "extraction_request"."input_deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "upload_object_key_uq" ON "upload" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "upload_workspace_idx" ON "upload" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "upload_expires_idx" ON "upload" USING btree ("expires_at") WHERE "upload"."status" <> 'deleted';--> statement-breakpoint
CREATE INDEX "upload_extraction_idx" ON "upload" USING btree ("extraction_request_id");--> statement-breakpoint
CREATE INDEX "import_item_run_idx" ON "import_item" USING btree ("import_run_id","row_number");--> statement-breakpoint
CREATE INDEX "import_item_workspace_idx" ON "import_item" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "import_run_workspace_idx" ON "import_run" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_data_key_one_active_uq" ON "workspace_data_key" USING btree ("workspace_id") WHERE "workspace_data_key"."status" = 'active';--> statement-breakpoint
CREATE INDEX "workspace_data_key_workspace_idx" ON "workspace_data_key" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "listing_content_property_kind_uq" ON "listing_content" USING btree ("property_id","kind");--> statement-breakpoint
CREATE INDEX "listing_content_workspace_idx" ON "listing_content" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "property_workspace_status_idx" ON "property" USING btree ("workspace_id","status","created_at");--> statement-breakpoint
CREATE INDEX "property_address_key_idx" ON "property" USING btree ("workspace_id","address_key");--> statement-breakpoint
CREATE UNIQUE INDEX "property_external_uq" ON "property" USING btree ("workspace_id","source_provider","external_id") WHERE "property"."external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "property_pms_connection_idx" ON "property" USING btree ("pms_connection_id");--> statement-breakpoint
CREATE INDEX "property_purge_idx" ON "property" USING btree ("purge_after") WHERE "property"."status" = 'removed';--> statement-breakpoint
CREATE INDEX "restricted_value_property_idx" ON "restricted_value" USING btree ("property_id","source_field");--> statement-breakpoint
CREATE INDEX "restricted_value_workspace_idx" ON "restricted_value" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feed_fingerprint_uq" ON "calendar_feed" USING btree ("property_id","url_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feed_channel_uq" ON "calendar_feed" USING btree ("property_id","channel") WHERE "calendar_feed"."channel" <> 'other';--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_feed_other_label_uq" ON "calendar_feed" USING btree ("property_id","channel_label") WHERE "calendar_feed"."channel" = 'other';--> statement-breakpoint
CREATE INDEX "calendar_feed_workspace_idx" ON "calendar_feed" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "calendar_feed_due_idx" ON "calendar_feed" USING btree ("last_success_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stay_feed_uid_uq" ON "stay" USING btree ("calendar_feed_id","external_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "stay_pms_uid_uq" ON "stay" USING btree ("pms_connection_id","external_uid") WHERE "stay"."pms_connection_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "stay_property_dates_idx" ON "stay" USING btree ("property_id","checkout_date");--> statement-breakpoint
CREATE INDEX "stay_workspace_idx" ON "stay" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "stay_guest_name_retention_idx" ON "stay" USING btree ("checkout_date") WHERE "stay"."guest_name" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pms_connection_account_uq" ON "pms_connection" USING btree ("workspace_id","provider","external_account_id") WHERE "pms_connection"."status" <> 'disconnected';--> statement-breakpoint
CREATE INDEX "pms_connection_due_idx" ON "pms_connection" USING btree ("last_refresh_at");--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_property_limit_positive" CHECK ("workspace"."property_limit" IS NULL OR "workspace"."property_limit" > 0);