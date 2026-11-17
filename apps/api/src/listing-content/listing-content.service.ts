import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type {
  ListingContentItem,
  ListingContentKind,
  ListingContentList,
  UpdateListingContentBody,
} from "@guidesk/contracts";
import {
  listingContent,
  upsertListingContent,
  type ListingContentSourceValues,
  type Transaction,
} from "@guidesk/db";
import { containsRestrictedValue, type Role } from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { RequestDb } from "../database/request-db.js";
import { PropertiesService } from "../properties/properties.service.js";

interface Caller {
  userId: string;
  role: Role;
}

type Row = typeof listingContent.$inferSelect;

function toItem(row: Row): ListingContentItem {
  return {
    kind: row.kind,
    body: row.body,
    items: row.items,
    language: row.language,
    source: row.source,
    reviewState: row.reviewState,
    updatedAt: row.updatedAt.toISOString(),
  };
}

const ORDER: Record<ListingContentKind, number> = {
  title: 0,
  description: 1,
  house_rules: 2,
  amenities: 3,
};

/**
 * Listing content: the structured text each creation path brings in, labeled with its source
 * until the host edits or approves it (FR-018, FR-033, T028). Shared by listing text (US2), PMS
 * imports (US4), and duplicates (US6).
 */
@Injectable()
export class ListingContentService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly properties: PropertiesService,
  ) {}

  /** Stores content from a source; reviewed rows are never replaced (FR-033). */
  upsertFromSource(tx: Transaction, values: ListingContentSourceValues): Promise<boolean> {
    return upsertListingContent(tx, values);
  }

  async list(caller: Caller, workspaceId: string, propertyId: string): Promise<ListingContentList> {
    await this.properties.load(caller, workspaceId, propertyId);
    const rows = await this.requestDb
      .current()
      .select()
      .from(listingContent)
      .where(
        and(eq(listingContent.propertyId, propertyId), eq(listingContent.workspaceId, workspaceId)),
      );
    return { items: rows.map(toItem).sort((a, b) => ORDER[a.kind] - ORDER[b.kind]) };
  }

  /**
   * The host's edit. Text that looks like a code is refused: codes belong in the guide's locked
   * fields, never in listing content (FR-013).
   */
  async edit(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    kind: ListingContentKind,
    body: UpdateListingContentBody,
  ): Promise<ListingContentItem> {
    await this.properties.load(caller, workspaceId, propertyId);
    const text = [body.body ?? "", ...(body.items ?? [])].join("\n");
    if (containsRestrictedValue(text)) {
      throw new ApiProblem(
        422,
        "validation_failed",
        "This looks like a code. Add codes in the guide's locked fields instead.",
        { fields: { [body.body != null ? "body" : "items"]: ["restricted_value"] } },
      );
    }
    const [row] = await this.requestDb
      .current()
      .update(listingContent)
      .set({
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.items !== undefined ? { items: body.items } : {}),
        reviewState: "edited",
        reviewedBy: caller.userId,
        reviewedAt: new Date(),
      })
      .where(and(eq(listingContent.propertyId, propertyId), eq(listingContent.kind, kind)))
      .returning();
    if (!row) throw new ApiProblem(404, "not_found");
    return toItem(row);
  }

  async approve(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    kind: ListingContentKind,
  ): Promise<ListingContentItem> {
    await this.properties.load(caller, workspaceId, propertyId);
    const [row] = await this.requestDb
      .current()
      .update(listingContent)
      .set({ reviewState: "approved", reviewedBy: caller.userId, reviewedAt: new Date() })
      .where(and(eq(listingContent.propertyId, propertyId), eq(listingContent.kind, kind)))
      .returning();
    if (!row) throw new ApiProblem(404, "not_found");
    return toItem(row);
  }
}
