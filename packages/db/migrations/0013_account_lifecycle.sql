CREATE TABLE "account_deletion_request" (
	"user_id" text PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"purge_after" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	CONSTRAINT "account_deletion_status_valid" CHECK ("account_deletion_request"."status" IN ('scheduled', 'completed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "email_change_request" (
	"user_id" text PRIMARY KEY NOT NULL,
	"new_email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace" DROP CONSTRAINT "workspace_created_by_user_id_fk";
--> statement-breakpoint
ALTER TABLE "workspace" ALTER COLUMN "created_by" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "email_change_request" ADD CONSTRAINT "email_change_request_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;