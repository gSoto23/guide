CREATE TABLE "guide_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"public_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"replaced_at" timestamp with time zone,
	"replaced_by" text,
	CONSTRAINT "guide_link_public_id_format" CHECK ("guide_link"."public_id" ~ '^[a-z2-7]{26}$'),
	CONSTRAINT "guide_link_status_valid" CHECK ("guide_link"."status" IN ('active', 'replaced')),
	CONSTRAINT "guide_link_replaced_consistent" CHECK (("guide_link"."status" = 'replaced') = ("guide_link"."replaced_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "guide_open_daily" (
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"day" date NOT NULL,
	"link_kind" text NOT NULL,
	"opens" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "guide_open_daily_property_id_day_link_kind_pk" PRIMARY KEY("property_id","day","link_kind"),
	CONSTRAINT "guide_open_daily_kind_valid" CHECK ("guide_open_daily"."link_kind" IN ('property', 'stay')),
	CONSTRAINT "guide_open_daily_opens" CHECK ("guide_open_daily"."opens" >= 0)
);
--> statement-breakpoint
CREATE TABLE "guide_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_link_id" uuid NOT NULL,
	"cookie_hash" text NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guide_session_cookie_hash_format" CHECK ("guide_session"."cookie_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "stay_link" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"token_ciphertext" "bytea" NOT NULL,
	"data_key_id" uuid NOT NULL,
	"confirmation_ciphertext" "bytea",
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_copied_at" timestamp with time zone,
	"last_copied_by" text,
	"ended_at" timestamp with time zone,
	"ended_by" text,
	"failure_count" smallint DEFAULT 0 NOT NULL,
	"failure_window_started_at" timestamp with time zone,
	"locked_until" timestamp with time zone,
	"lockout_count" smallint DEFAULT 0 NOT NULL,
	"last_lockout_at" timestamp with time zone,
	CONSTRAINT "stay_link_token_hash_format" CHECK ("stay_link"."token_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "stay_link_status_valid" CHECK ("stay_link"."status" IN ('active', 'revoked', 'replaced')),
	CONSTRAINT "stay_link_ended_consistent" CHECK (("stay_link"."status" = 'active') = ("stay_link"."ended_at" IS NULL)),
	CONSTRAINT "stay_link_counts" CHECK ("stay_link"."failure_count" >= 0 AND "stay_link"."lockout_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "guide" ADD COLUMN "require_confirmation_code" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "guide_link" ADD CONSTRAINT "guide_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_link" ADD CONSTRAINT "guide_link_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_link" ADD CONSTRAINT "guide_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_link" ADD CONSTRAINT "guide_link_replaced_by_user_id_fk" FOREIGN KEY ("replaced_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_open_daily" ADD CONSTRAINT "guide_open_daily_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_open_daily" ADD CONSTRAINT "guide_open_daily_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_session" ADD CONSTRAINT "guide_session_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_session" ADD CONSTRAINT "guide_session_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guide_session" ADD CONSTRAINT "guide_session_stay_link_id_stay_link_id_fk" FOREIGN KEY ("stay_link_id") REFERENCES "public"."stay_link"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_link" ADD CONSTRAINT "stay_link_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_link" ADD CONSTRAINT "stay_link_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_link" ADD CONSTRAINT "stay_link_stay_id_stay_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stay"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_link" ADD CONSTRAINT "stay_link_data_key_id_workspace_data_key_id_fk" FOREIGN KEY ("data_key_id") REFERENCES "public"."workspace_data_key"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_link" ADD CONSTRAINT "stay_link_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_link" ADD CONSTRAINT "stay_link_last_copied_by_user_id_fk" FOREIGN KEY ("last_copied_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_link" ADD CONSTRAINT "stay_link_ended_by_user_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guide_link_public_id_uq" ON "guide_link" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guide_link_active_uq" ON "guide_link" USING btree ("property_id") WHERE "guide_link"."status" = 'active';--> statement-breakpoint
CREATE INDEX "guide_link_workspace_idx" ON "guide_link" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "guide_open_daily_workspace_idx" ON "guide_open_daily" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guide_session_cookie_hash_uq" ON "guide_session" USING btree ("cookie_hash");--> statement-breakpoint
CREATE INDEX "guide_session_link_idx" ON "guide_session" USING btree ("stay_link_id");--> statement-breakpoint
CREATE INDEX "guide_session_workspace_idx" ON "guide_session" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stay_link_token_hash_uq" ON "stay_link" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "stay_link_active_uq" ON "stay_link" USING btree ("stay_id") WHERE "stay_link"."status" = 'active';--> statement-breakpoint
CREATE INDEX "stay_link_property_idx" ON "stay_link" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "stay_link_workspace_idx" ON "stay_link" USING btree ("workspace_id");