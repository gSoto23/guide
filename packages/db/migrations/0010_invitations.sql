CREATE TABLE "invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" text,
	"expires_at" timestamp with time zone NOT NULL,
	"send_count" integer DEFAULT 1 NOT NULL,
	"last_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_by" text,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitation_role_valid" CHECK ("invitation"."role" IN ('admin', 'agent')),
	CONSTRAINT "invitation_status_valid" CHECK ("invitation"."status" IN ('pending', 'accepted', 'revoked', 'expired')),
	CONSTRAINT "invitation_email_normalized" CHECK ("invitation"."email" = lower(btrim("invitation"."email")))
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "seat_limit" integer;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_accepted_by_user_id_fk" FOREIGN KEY ("accepted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_token_hash_uq" ON "invitation" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "invitation_pending_email_uq" ON "invitation" USING btree ("workspace_id","email") WHERE "invitation"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "invitation_workspace_idx" ON "invitation" USING btree ("workspace_id","created_at");--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_seat_limit_positive" CHECK ("workspace"."seat_limit" IS NULL OR "workspace"."seat_limit" > 0);