-- Feature 003 US7: an override's copied items remember their shared block, so "Reset to shared"
-- removes exactly those copies (FR-059, research R14).
--> statement-breakpoint
ALTER TABLE "guide_item" ADD COLUMN "copied_from_block_id" uuid;--> statement-breakpoint
ALTER TABLE "guide_item" ADD CONSTRAINT "guide_item_copied_from_block_id_shared_block_id_fk" FOREIGN KEY ("copied_from_block_id") REFERENCES "public"."shared_block"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "guide_item_copied_from_block_idx" ON "guide_item" USING btree ("copied_from_block_id");