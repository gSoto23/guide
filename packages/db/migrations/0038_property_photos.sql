ALTER TABLE "extra" ADD COLUMN "media_id" uuid;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "cover_media_id" uuid;--> statement-breakpoint
ALTER TABLE "property" ADD COLUMN "cover_alt" text;--> statement-breakpoint
ALTER TABLE "extra" ADD CONSTRAINT "extra_media_id_media_object_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media_object"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_cover_media_id_media_object_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media_object"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property" ADD CONSTRAINT "property_cover_alt_length" CHECK ("property"."cover_alt" IS NULL OR char_length("property"."cover_alt") BETWEEN 1 AND 160);--> statement-breakpoint
-- Feature 016: requests may set or remove an extra's photo (the role has column-level UPDATE on extra).
GRANT UPDATE (media_id) ON extra TO guidesk_app;
