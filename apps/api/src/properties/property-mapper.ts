import type { PropertyDetail, PropertySummary } from "@guidesk/contracts";
import type { property } from "@guidesk/db";

export type PropertyRow = typeof property.$inferSelect;

/** `time` columns come back as HH:MM:SS; the API speaks HH:MM (FR-005). */
export function toTimeOfDay(value: string | null): string | null {
  return value ? value.slice(0, 5) : null;
}

export function toSummary(
  row: Pick<
    PropertyRow,
    | "id"
    | "name"
    | "setupStatus"
    | "missingFacts"
    | "source"
    | "sourceProvider"
    | "pmsStatus"
    | "status"
    | "createdAt"
    | "purgeAfter"
  >,
  calendarStatus: PropertySummary["calendarStatus"],
): PropertySummary {
  return {
    id: row.id,
    name: row.name,
    setupStatus: row.setupStatus,
    missingFacts: row.missingFacts as PropertySummary["missingFacts"],
    source: row.source,
    sourceProvider: row.sourceProvider,
    pmsStatus: row.pmsStatus,
    calendarStatus,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    purgeAfter: row.purgeAfter?.toISOString() ?? null,
  };
}

export function toDetail(
  row: PropertyRow,
  calendarStatus: PropertySummary["calendarStatus"],
  counts: PropertyDetail["counts"],
): PropertyDetail {
  return {
    ...toSummary(row, calendarStatus),
    addressLine1: row.addressLine1,
    addressUnit: row.addressUnit,
    city: row.city,
    region: row.region,
    postalCode: row.postalCode,
    country: row.country,
    timeZone: row.timeZone,
    checkInTime: toTimeOfDay(row.checkInTime),
    checkoutTime: toTimeOfDay(row.checkoutTime),
    maxGuests: row.maxGuests,
    guideLanguages: row.guideLanguages,
    editedFacts: row.editedFacts,
    updatedAt: row.updatedAt.toISOString(),
    counts,
  };
}
