import { z } from "zod";
import {
  LISTING_CONTENT_KIND_VALUES,
  LISTING_CONTENT_SOURCE_VALUES,
  REVIEW_STATE_VALUES,
} from "./values.js";

/** Contracts for listing content (feature 002 FR-018, FR-019, FR-033; data model §1). */
export const listingContentKindSchema = z.enum(LISTING_CONTENT_KIND_VALUES);
export type ListingContentKind = z.infer<typeof listingContentKindSchema>;

/** A content item accepted from an extraction, or edited by the host. */
export const contentItemInputSchema = z
  .object({
    kind: listingContentKindSchema,
    body: z.string().trim().min(1).max(20_000).nullable().optional(),
    items: z.array(z.string().trim().min(1).max(120)).max(200).nullable().optional(),
    /** BCP 47 tag; content keeps its language (FR-019). */
    language: z.string().trim().min(2).max(35).nullable().optional(),
    /** The host changed it while reviewing the extraction, so it is stored as edited (US2 scenario 7). */
    edited: z.boolean().optional(),
  })
  .strict()
  .refine(
    (item) => (item.kind === "amenities" ? Boolean(item.items?.length) : Boolean(item.body)),
    {
      message: "Amenities need items; other kinds need a body",
    },
  );
export type ContentItemInput = z.infer<typeof contentItemInputSchema>;

export const listingContentItemSchema = z.object({
  kind: listingContentKindSchema,
  body: z.string().nullable(),
  items: z.array(z.string()).nullable(),
  language: z.string().nullable(),
  source: z.enum(LISTING_CONTENT_SOURCE_VALUES),
  reviewState: z.enum(REVIEW_STATE_VALUES),
  updatedAt: z.iso.datetime(),
});
export type ListingContentItem = z.infer<typeof listingContentItemSchema>;

export const listingContentListSchema = z.object({ items: z.array(listingContentItemSchema) });
export type ListingContentList = z.infer<typeof listingContentListSchema>;

/** PUT …/listing-content/{kind}: the host's edit (US2 scenario 7). */
export const updateListingContentSchema = z
  .object({
    body: z.string().trim().min(1).max(20_000).nullable().optional(),
    items: z.array(z.string().trim().min(1).max(120)).max(200).nullable().optional(),
  })
  .strict()
  .refine((body) => body.body != null || (body.items != null && body.items.length > 0), {
    message: "Provide the text or the items",
  });
export type UpdateListingContentBody = z.infer<typeof updateListingContentSchema>;
