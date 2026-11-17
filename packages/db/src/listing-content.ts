import { sql } from "drizzle-orm";
import type { Database } from "./client.js";
import type { Transaction } from "./rls.js";
import { listingContent } from "./schema/properties.js";

export interface ListingContentSourceValues {
  workspaceId: string;
  propertyId: string;
  kind: (typeof listingContent.$inferInsert)["kind"];
  body?: string | null;
  items?: string[] | null;
  language?: string | null;
  source: (typeof listingContent.$inferInsert)["source"];
  extractionRequestId?: string | null;
  /** The host who edited it before it was stored; the row is then `edited`, not `unreviewed`. */
  editedBy?: string | null;
}

/**
 * Stores content from an extraction, an import, or a copy (FR-018, FR-033). A row is replaced
 * only while it is `unreviewed`: content the host edited or approved is never overwritten. Works
 * in the request context (owners and admins) and in the worker's system context. Returns true
 * when the row was written.
 */
export async function upsertListingContent(
  db: Database | Transaction,
  values: ListingContentSourceValues,
): Promise<boolean> {
  const rows = await db
    .insert(listingContent)
    .values({
      workspaceId: values.workspaceId,
      propertyId: values.propertyId,
      kind: values.kind,
      body: values.body ?? null,
      items: values.items ?? null,
      language: values.language ?? null,
      source: values.source,
      reviewState: values.editedBy ? "edited" : "unreviewed",
      reviewedBy: values.editedBy ?? null,
      reviewedAt: values.editedBy ? new Date() : null,
      extractionRequestId: values.extractionRequestId ?? null,
    })
    .onConflictDoUpdate({
      target: [listingContent.propertyId, listingContent.kind],
      set: {
        body: sql`excluded.body`,
        items: sql`excluded.items`,
        language: sql`excluded.language`,
        source: sql`excluded.source`,
        extractionRequestId: sql`excluded.extraction_request_id`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${listingContent.reviewState} = 'unreviewed'`,
    })
    .returning({ id: listingContent.id });
  return rows.length > 0;
}
