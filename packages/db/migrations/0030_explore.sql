CREATE TABLE "experience" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner" text NOT NULL,
	"product_id" text NOT NULL,
	"destination_key" text NOT NULL,
	"language" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"includes" text,
	"duration_minutes" integer,
	"price_from" numeric(12, 2),
	"currency" char(3),
	"rating" numeric(3, 2),
	"review_count" integer,
	"image_url" text,
	"image_width" integer,
	"image_height" integer,
	"partner_url" text NOT NULL,
	"machine_translated" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "experience_product_uq" UNIQUE("partner","product_id","destination_key","language"),
	CONSTRAINT "experience_partner_valid" CHECK ("experience"."partner" IN ('viator')),
	CONSTRAINT "experience_language_valid" CHECK ("experience"."language" IN ('es', 'en')),
	CONSTRAINT "experience_category_valid" CHECK ("experience"."category" IN ('tours','food_drink','outdoor','water','culture','day_trips','other')),
	CONSTRAINT "experience_product_id" CHECK ("experience"."product_id" ~ '^[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "experience_title_len" CHECK (char_length("experience"."title") BETWEEN 1 AND 200),
	CONSTRAINT "experience_description_len" CHECK (char_length("experience"."description") <= 2000),
	CONSTRAINT "experience_includes_len" CHECK ("experience"."includes" IS NULL OR char_length("experience"."includes") <= 1000),
	CONSTRAINT "experience_duration" CHECK ("experience"."duration_minutes" IS NULL OR "experience"."duration_minutes" BETWEEN 1 AND 20160),
	CONSTRAINT "experience_price" CHECK (("experience"."price_from" IS NULL) = ("experience"."currency" IS NULL) AND ("experience"."price_from" IS NULL OR "experience"."price_from" >= 0)),
	CONSTRAINT "experience_currency" CHECK ("experience"."currency" IS NULL OR "experience"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "experience_rating" CHECK ("experience"."rating" IS NULL OR "experience"."rating" BETWEEN 0 AND 5),
	CONSTRAINT "experience_reviews" CHECK ("experience"."review_count" IS NULL OR "experience"."review_count" >= 0),
	CONSTRAINT "experience_image" CHECK (("experience"."image_url" IS NULL OR ("experience"."image_url" LIKE 'https://%' AND char_length("experience"."image_url") <= 2000))
        AND (("experience"."image_url" IS NULL) = ("experience"."image_width" IS NULL))
        AND (("experience"."image_url" IS NULL) = ("experience"."image_height" IS NULL))),
	CONSTRAINT "experience_partner_url" CHECK ("experience"."partner_url" LIKE 'https://%' AND char_length("experience"."partner_url") <= 2000),
	CONSTRAINT "experience_expiry" CHECK ("experience"."expires_at" > "experience"."fetched_at")
);
--> statement-breakpoint
CREATE TABLE "experience_click_daily" (
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"day" date NOT NULL,
	"partner" text NOT NULL,
	"ref" text NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "experience_click_daily_property_id_day_ref_pk" PRIMARY KEY("property_id","day","ref"),
	CONSTRAINT "experience_click_daily_partner_valid" CHECK ("experience_click_daily"."partner" IN ('viator', 'civitatis')),
	CONSTRAINT "experience_click_daily_ref" CHECK ("experience_click_daily"."ref" ~ '^(viator|civitatis)-[A-Za-z0-9_-]{1,64}$'),
	CONSTRAINT "experience_click_daily_clicks" CHECK ("experience_click_daily"."clicks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "experience_destination" (
	"key" text PRIMARY KEY NOT NULL,
	"country" char(2) NOT NULL,
	"city" text NOT NULL,
	"region" text,
	"viator_destination_id" text,
	"mapped_at" timestamp with time zone,
	CONSTRAINT "experience_destination_key_len" CHECK (char_length("experience_destination"."key") BETWEEN 4 AND 120),
	CONSTRAINT "experience_destination_city_len" CHECK (char_length("experience_destination"."city") BETWEEN 1 AND 120),
	CONSTRAINT "experience_destination_region_len" CHECK ("experience_destination"."region" IS NULL OR char_length("experience_destination"."region") <= 120),
	CONSTRAINT "experience_destination_viator_id" CHECK ("experience_destination"."viator_destination_id" IS NULL OR "experience_destination"."viator_destination_id" ~ '^[0-9]{1,12}$')
);
--> statement-breakpoint
CREATE TABLE "experience_partner_reference" (
	"partner" text NOT NULL,
	"kind" text NOT NULL,
	"data" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "experience_partner_reference_partner_kind_pk" PRIMARY KEY("partner","kind"),
	CONSTRAINT "experience_partner_reference_partner_valid" CHECK ("experience_partner_reference"."partner" IN ('viator')),
	CONSTRAINT "experience_partner_reference_kind_valid" CHECK ("experience_partner_reference"."kind" IN ('destinations', 'tags'))
);
--> statement-breakpoint
CREATE TABLE "experience_refresh" (
	"destination_key" text NOT NULL,
	"partner" text NOT NULL,
	"last_attempt_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "experience_refresh_destination_key_partner_pk" PRIMARY KEY("destination_key","partner"),
	CONSTRAINT "experience_refresh_partner_valid" CHECK ("experience_refresh"."partner" IN ('viator')),
	CONSTRAINT "experience_refresh_failures" CHECK ("experience_refresh"."failures" >= 0),
	CONSTRAINT "experience_refresh_error_valid" CHECK ("experience_refresh"."last_error" IS NULL OR "experience_refresh"."last_error" IN ('timeout', 'http_429', 'http_4xx', 'http_5xx', 'invalid'))
);
--> statement-breakpoint
CREATE TABLE "explore_open_daily" (
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"day" date NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "explore_open_daily_property_id_day_pk" PRIMARY KEY("property_id","day"),
	CONSTRAINT "explore_open_daily_opens" CHECK ("explore_open_daily"."opens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "explore_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid,
	"follows_default" boolean DEFAULT true NOT NULL,
	"experiences_enabled" boolean DEFAULT true NOT NULL,
	"hidden_categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"hidden_experiences" text[] DEFAULT '{}'::text[] NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "explore_settings_scope_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","property_id"),
	CONSTRAINT "explore_settings_categories_valid" CHECK ("explore_settings"."hidden_categories" <@ ARRAY['tours','food_drink','outdoor','water','culture','day_trips','other']::text[]),
	CONSTRAINT "explore_settings_hidden_len" CHECK (cardinality("explore_settings"."hidden_experiences") <= 200),
	CONSTRAINT "explore_settings_workspace_row" CHECK ("explore_settings"."property_id" IS NOT NULL OR ("explore_settings"."follows_default" AND cardinality("explore_settings"."hidden_experiences") = 0)),
	CONSTRAINT "explore_settings_version" CHECK ("explore_settings"."version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "experience" ADD CONSTRAINT "experience_destination_key_experience_destination_key_fk" FOREIGN KEY ("destination_key") REFERENCES "public"."experience_destination"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_click_daily" ADD CONSTRAINT "experience_click_daily_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_click_daily" ADD CONSTRAINT "experience_click_daily_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experience_refresh" ADD CONSTRAINT "experience_refresh_destination_key_experience_destination_key_fk" FOREIGN KEY ("destination_key") REFERENCES "public"."experience_destination"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explore_open_daily" ADD CONSTRAINT "explore_open_daily_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explore_open_daily" ADD CONSTRAINT "explore_open_daily_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explore_settings" ADD CONSTRAINT "explore_settings_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explore_settings" ADD CONSTRAINT "explore_settings_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explore_settings" ADD CONSTRAINT "explore_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "experience_destination_idx" ON "experience" USING btree ("destination_key","expires_at");--> statement-breakpoint
CREATE INDEX "experience_click_daily_workspace_idx" ON "experience_click_daily" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "explore_open_daily_workspace_idx" ON "explore_open_daily" USING btree ("workspace_id");