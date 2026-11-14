CREATE TABLE "onboarding_profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"properties_bucket" text,
	"pms" text,
	"pms_other" text,
	"country" text,
	"path" text DEFAULT 'individual' NOT NULL,
	"skipped" boolean DEFAULT false NOT NULL,
	"answered_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "onboarding_bucket_valid" CHECK ("onboarding_profile"."properties_bucket" IS NULL OR "onboarding_profile"."properties_bucket" IN ('1_2', '3_10', '10_plus')),
	CONSTRAINT "onboarding_pms_valid" CHECK ("onboarding_profile"."pms" IS NULL OR "onboarding_profile"."pms" IN ('hostaway', 'guesty', 'hospitable', 'smoobu', 'ownerrez', 'hostfully', 'beds24', 'hostex', 'lodgify', 'uplisting', 'stays_net', 'other', 'none')),
	CONSTRAINT "onboarding_pms_other_valid" CHECK (("onboarding_profile"."pms_other" IS NULL OR ("onboarding_profile"."pms" = 'other' AND char_length("onboarding_profile"."pms_other") <= 80))),
	CONSTRAINT "onboarding_country_valid" CHECK ("onboarding_profile"."country" IS NULL OR "onboarding_profile"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "onboarding_path_valid" CHECK ("onboarding_profile"."path" IN ('individual', 'manager'))
);
--> statement-breakpoint
CREATE TABLE "membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"invited_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_role_valid" CHECK ("membership"."role" IN ('owner', 'admin', 'agent'))
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deleted_at" timestamp with time zone,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_name_length" CHECK (char_length("workspace"."name") BETWEEN 1 AND 80),
	CONSTRAINT "workspace_status_valid" CHECK ("workspace"."status" IN ('active', 'pending_deletion'))
);
--> statement-breakpoint
ALTER TABLE "onboarding_profile" ADD CONSTRAINT "onboarding_profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership" ADD CONSTRAINT "membership_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "membership_workspace_user_uq" ON "membership" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_one_owner_uq" ON "membership" USING btree ("workspace_id") WHERE "membership"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "membership" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "workspace_created_by_idx" ON "workspace" USING btree ("created_by");