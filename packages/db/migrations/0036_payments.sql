CREATE TABLE "payment_event" (
	"provider" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"order_id" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_event_provider_event_id_pk" PRIMARY KEY("provider","event_id")
);
--> statement-breakpoint
CREATE TABLE "payment_order" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"stay_id" uuid,
	"service_request_id" uuid,
	"provider" text NOT NULL,
	"provider_reference" text,
	"status" text DEFAULT 'open' NOT NULL,
	"currency" char(3) NOT NULL,
	"amount_minor" bigint NOT NULL,
	"platform_fee_bps" integer NOT NULL,
	"platform_fee_minor" bigint NOT NULL,
	"provider_fee_minor" bigint,
	"host_share_minor" bigint,
	"refunded_minor" bigint DEFAULT 0 NOT NULL,
	"refund_due" boolean DEFAULT false NOT NULL,
	"checkout_url" text,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_order_status_valid" CHECK ("payment_order"."status" IN ('open', 'paid', 'partially_refunded', 'refunded', 'disputed', 'failed', 'expired', 'cancelled')),
	CONSTRAINT "payment_order_provider_valid" CHECK ("payment_order"."provider" IN ('simulated', 'tilopay')),
	CONSTRAINT "payment_order_amount_positive" CHECK ("payment_order"."amount_minor" > 0),
	CONSTRAINT "payment_order_fee_bps_range" CHECK ("payment_order"."platform_fee_bps" BETWEEN 0 AND 3000),
	CONSTRAINT "payment_order_refunded_range" CHECK ("payment_order"."refunded_minor" BETWEEN 0 AND "payment_order"."amount_minor")
);
--> statement-breakpoint
CREATE TABLE "payment_refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"status" text NOT NULL,
	"provider_refund_id" text,
	"requested_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_refund_status_valid" CHECK ("payment_refund"."status" IN ('succeeded', 'pending', 'failed')),
	CONSTRAINT "payment_refund_amount_positive" CHECK ("payment_refund"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "payout_account" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_account_id" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payout_account_provider_valid" CHECK ("payout_account"."provider" IN ('simulated', 'tilopay')),
	CONSTRAINT "payout_account_status_valid" CHECK ("payout_account"."status" IN ('pending', 'active', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "platform_fee_bps" integer;--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_property_id_property_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."property"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_stay_id_stay_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stay"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_order" ADD CONSTRAINT "payment_order_service_request_id_service_request_id_fk" FOREIGN KEY ("service_request_id") REFERENCES "public"."service_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_order_id_payment_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."payment_order"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_refund" ADD CONSTRAINT "payment_refund_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payout_account" ADD CONSTRAINT "payout_account_workspace_id_workspace_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_open_request_uq" ON "payment_order" USING btree ("service_request_id") WHERE "payment_order"."status" = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "payment_order_provider_reference_uq" ON "payment_order" USING btree ("provider","provider_reference");--> statement-breakpoint
CREATE INDEX "payment_order_workspace_paid_idx" ON "payment_order" USING btree ("workspace_id","paid_at");--> statement-breakpoint
CREATE INDEX "payment_order_request_idx" ON "payment_order" USING btree ("service_request_id");--> statement-breakpoint
CREATE INDEX "payment_refund_order_idx" ON "payment_refund" USING btree ("order_id");--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_platform_fee_bps_range" CHECK ("workspace"."platform_fee_bps" IS NULL OR "workspace"."platform_fee_bps" BETWEEN 0 AND 3000);--> statement-breakpoint
-- Feature 013 (data model): members read their workspace's payouts, orders, and refunds; only the
-- system context writes. Provider events are system only.
ALTER TABLE payout_account ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payout_account FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_order ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_order FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_refund ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_refund FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_event ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE payment_event FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY payout_account_system ON payout_account FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY payment_order_system ON payment_order FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY payment_refund_system ON payment_refund FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY payment_event_system ON payment_event FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY payout_account_read ON payout_account FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY payment_order_read ON payment_order FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY payment_refund_read ON payment_refund FOR SELECT TO guidesk_app
  USING (workspace_id = app_current_workspace_id() AND app_current_workspace_role() IS NOT NULL);
--> statement-breakpoint
GRANT SELECT ON payout_account, payment_order, payment_refund TO guidesk_app;
