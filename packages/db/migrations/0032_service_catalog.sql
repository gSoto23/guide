CREATE TABLE "extra" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"source_language" text NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"lead_time_hours" integer DEFAULT 0 NOT NULL,
	"weekdays" smallint[] DEFAULT '{1,2,3,4,5,6,7}'::smallint[] NOT NULL,
	"needs_date" boolean DEFAULT false NOT NULL,
	"needs_time" boolean DEFAULT false NOT NULL,
	"date_range" text DEFAULT 'stay' NOT NULL,
	"max_per_stay" integer DEFAULT 1 NOT NULL,
	"pre_approved" boolean DEFAULT false NOT NULL,
	"turnover" text,
	"visible" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "extra_source_language_valid" CHECK ("extra"."source_language" IN ('es', 'en')),
	CONSTRAINT "extra_name_valid" CHECK (jsonb_typeof("extra"."name") = 'object' AND "extra"."name" ? "extra"."source_language"
        AND char_length(coalesce("extra"."name"->>'es', 'x')) BETWEEN 1 AND 80
        AND char_length(coalesce("extra"."name"->>'en', 'x')) BETWEEN 1 AND 80),
	CONSTRAINT "extra_description_valid" CHECK (jsonb_typeof("extra"."description") = 'object'
        AND char_length(coalesce("extra"."description"->>'es', '')) <= 500
        AND char_length(coalesce("extra"."description"->>'en', '')) <= 500),
	CONSTRAINT "extra_price" CHECK ("extra"."price" BETWEEN 0 AND 100000),
	CONSTRAINT "extra_currency_valid" CHECK ("extra"."currency" IN ('USD', 'CRC', 'MXN', 'EUR', 'COP', 'GTQ')),
	CONSTRAINT "extra_lead_time" CHECK ("extra"."lead_time_hours" BETWEEN 0 AND 720),
	CONSTRAINT "extra_weekdays_valid" CHECK (cardinality("extra"."weekdays") BETWEEN 1 AND 7 AND "extra"."weekdays" <@ '{1,2,3,4,5,6,7}'::smallint[]),
	CONSTRAINT "extra_time_needs_date" CHECK (NOT "extra"."needs_time" OR "extra"."needs_date" OR "extra"."turnover" IS NOT NULL),
	CONSTRAINT "extra_date_range_valid" CHECK ("extra"."date_range" IN ('stay', 'before_arrival')),
	CONSTRAINT "extra_max_per_stay" CHECK ("extra"."max_per_stay" BETWEEN 1 AND 10),
	CONSTRAINT "extra_turnover_valid" CHECK ("extra"."turnover" IS NULL OR ("extra"."turnover" IN ('early_check_in', 'late_checkout') AND NOT "extra"."needs_date")),
	CONSTRAINT "extra_position" CHECK ("extra"."position" >= 0),
	CONSTRAINT "extra_version" CHECK ("extra"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "service_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"extra_id" uuid,
	"extra_name" jsonb NOT NULL,
	"source_language" text NOT NULL,
	"price" numeric(10, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"requested_date" date,
	"requested_time" time,
	"quantity" integer DEFAULT 1 NOT NULL,
	"note" text,
	"status" text DEFAULT 'waiting' NOT NULL,
	"reason_code" text,
	"reason_text" text,
	"answered_by" text,
	"answered_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_request_status_valid" CHECK ("service_request"."status" IN ('waiting', 'confirmed', 'declined', 'cancelled', 'host_cancelled', 'expired')),
	CONSTRAINT "service_request_currency_valid" CHECK ("service_request"."currency" IN ('USD', 'CRC', 'MXN', 'EUR', 'COP', 'GTQ')),
	CONSTRAINT "service_request_price" CHECK ("service_request"."price" BETWEEN 0 AND 100000),
	CONSTRAINT "service_request_quantity" CHECK ("service_request"."quantity" BETWEEN 1 AND 10),
	CONSTRAINT "service_request_note_len" CHECK ("service_request"."note" IS NULL OR char_length("service_request"."note") BETWEEN 1 AND 300),
	CONSTRAINT "service_request_reason_valid" CHECK ("service_request"."reason_code" IS NULL OR "service_request"."reason_code" IN ('unavailable', 'fully_booked', 'too_late', 'other', 'stay')),
	CONSTRAINT "service_request_reason_text_len" CHECK ("service_request"."reason_text" IS NULL OR char_length("service_request"."reason_text") BETWEEN 1 AND 200),
	CONSTRAINT "service_request_answered" CHECK (("service_request"."answered_by" IS NULL) OR ("service_request"."answered_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "service_request_daily" (
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"day" date NOT NULL,
	"status" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "service_request_daily_property_id_day_status_pk" PRIMARY KEY("property_id","day","status"),
	CONSTRAINT "service_request_daily_status_valid" CHECK ("service_request_daily"."status" IN ('waiting', 'confirmed', 'declined', 'cancelled', 'host_cancelled', 'expired')),
	CONSTRAINT "service_request_daily_count" CHECK ("service_request_daily"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "extra" ADD CONSTRAINT "extra_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra" ADD CONSTRAINT "extra_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extra" ADD CONSTRAINT "extra_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_stay_id_stay_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stay"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_extra_id_extra_id_fk" FOREIGN KEY ("extra_id") REFERENCES "public"."extra"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request" ADD CONSTRAINT "service_request_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_daily" ADD CONSTRAINT "service_request_daily_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_daily" ADD CONSTRAINT "service_request_daily_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "extra_property_idx" ON "extra" USING btree ("property_id","position");--> statement-breakpoint
CREATE INDEX "service_request_status_idx" ON "service_request" USING btree ("workspace_id","status","expires_at");--> statement-breakpoint
CREATE INDEX "service_request_stay_idx" ON "service_request" USING btree ("stay_id","created_at");--> statement-breakpoint
CREATE INDEX "service_request_unnotified_idx" ON "service_request" USING btree ("created_at") WHERE "service_request"."notified_at" IS NULL;--> statement-breakpoint
CREATE INDEX "service_request_daily_workspace_idx" ON "service_request_daily" USING btree ("workspace_id");