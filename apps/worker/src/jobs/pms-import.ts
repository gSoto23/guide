import { and, asc, eq, sql } from "drizzle-orm";
import {
  createGuideForProperty,
  importItem,
  importRun,
  lockPropertySlots,
  pmsConnection,
  property,
  restrictedValue,
  upsertListingContent,
  type Database,
} from "@guidesk/db";
import {
  defaultGuideLanguages,
  initialSetupStatus,
  JOB_QUEUES,
  missingFacts,
  normalizeAddressKey,
  roomLeft,
  redactRestrictedValues,
  removeRedactedLines,
  setupStatusAfterEdit,
  suggestTimeZone,
  type CoreFacts,
  type GuideLanguage,
} from "@guidesk/domain";
import { renderImportFinished } from "@guidesk/emails";
import {
  amenityLabels,
  PmsCredentialError,
  type EmailMessage,
  type PmsListing,
  type PmsReservation,
  type PmsText,
} from "@guidesk/integrations";
import { createDataKeyStore, type Vault } from "@guidesk/vault";
import { notifyManagers } from "../notify.js";
import {
  addDays,
  applyReservations,
  pmsToday,
  loadConnection,
  recordEvent,
  type PmsJobDeps,
} from "./pms-common.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * The background PMS import (feature 002 FR-028 to FR-033, T095). One paged read of the listings
 * and one of the reservations, then each selected listing in order: a creation slot (or
 * `plan_limit`), facts with a suggested time zone, content with codes moved to encrypted
 * restricted values, and the upcoming stays. A re-import updates by `external_id` and keeps what
 * the host edited.
 */
export interface PmsImportJob {
  importRunId: string;
  workspaceId: string;
}

export interface PmsImportDeps extends PmsJobDeps {
  vault: Vault;
  queueEmail: (message: EmailMessage) => Promise<void>;
  portalUrl: string;
  span?: JobSpanDeps;
}

export type PmsImportOutcome = "skipped" | "completed" | "failed";

const PROVIDER_NAMES = { beds24: "Beds24", hostex: "Hostex" } as const;
const CONTENT_KINDS = ["title", "description", "house_rules"] as const;
/** Stays with checkout up to a year ahead are imported (T095). */
const STAY_WINDOW_DAYS = 365;

function factsOf(listing: PmsListing, languages: GuideLanguage[]): CoreFacts {
  const facts = listing.facts;
  const zone =
    facts.country && suggestTimeZone(facts.country, facts.city).suggested
      ? suggestTimeZone(facts.country, facts.city).suggested
      : null;
  return {
    name: listing.name.slice(0, 120),
    addressLine1: facts.addressLine1?.slice(0, 200) ?? null,
    city: facts.city?.slice(0, 120) ?? null,
    region: facts.region?.slice(0, 120) ?? null,
    postalCode: facts.postalCode?.slice(0, 20) ?? null,
    country: facts.country,
    timeZone: zone,
    checkInTime: facts.checkInTime,
    checkoutTime: facts.checkoutTime,
    maxGuests: facts.maxGuests,
    guideLanguages: languages,
  };
}

/** Spanish first unless the listing's texts are only in English (FR-003). */
function languagesOf(listing: PmsListing): GuideLanguage[] {
  const languages = new Set(listing.texts.map((text) => text.language?.slice(0, 2).toLowerCase()));
  return defaultGuideLanguages(languages.has("en") && !languages.has("es") ? "en" : "es");
}

/** The text of a kind in the guide's first language, else in any language. */
function pickText(texts: readonly PmsText[], kind: PmsText["kind"], language: string) {
  const ofKind = texts.filter((text) => text.kind === kind && text.body.trim());
  return ofKind.find((text) => text.language?.slice(0, 2).toLowerCase() === language) ?? ofKind[0];
}

/**
 * Stores a listing's content (FR-018, FR-031): codes found in it become encrypted restricted
 * values with their source field, and the lines that held them are left out of the content.
 * Content the host edited or approved is never replaced (FR-033).
 */
async function storeContent(
  deps: PmsImportDeps,
  tx: Database,
  input: {
    workspaceId: string;
    propertyId: string;
    provider: "beds24" | "hostex";
    listing: PmsListing;
    language: GuideLanguage;
  },
): Promise<void> {
  for (const kind of CONTENT_KINDS) {
    const text = pickText(input.listing.texts, kind, input.language);
    if (!text) continue;
    const redacted = redactRestrictedValues(text.body);
    // A re-import replaces the codes found in the same field, so none is stored twice.
    await tx
      .delete(restrictedValue)
      .where(
        and(
          eq(restrictedValue.propertyId, input.propertyId),
          eq(restrictedValue.sourceField, text.sourceField.slice(0, 80)),
        ),
      );
    for (const match of redacted.matches) {
      const id = crypto.randomUUID();
      const { ciphertext, dataKeyId } = await deps.vault.encrypt(
        createDataKeyStore(tx),
        {
          workspaceId: input.workspaceId,
          table: "restricted_value",
          column: "value_ciphertext",
          rowId: id,
        },
        match.value,
      );
      await tx.insert(restrictedValue).values({
        id,
        workspaceId: input.workspaceId,
        propertyId: input.propertyId,
        kind: match.kind,
        label: `${PROVIDER_NAMES[input.provider]} · ${kind}`.slice(0, 80),
        valueCiphertext: ciphertext,
        dataKeyId,
        source: "pms",
        sourceField: text.sourceField.slice(0, 80),
        // Feature 003: a locked field of the guide, listed in Wi-Fi or Arrival (FR-022).
        sectionKind: match.kind === "wifi_password" ? "wifi" : "arrival",
        valueSetAt: new Date(),
      });
    }
    const body = removeRedactedLines(redacted.text).slice(0, kind === "title" ? 120 : 20_000);
    if (!body) continue;
    await upsertListingContent(tx, {
      workspaceId: input.workspaceId,
      propertyId: input.propertyId,
      kind,
      body,
      language: text.language,
      source: "pms",
    });
  }
  const amenities = amenityLabels(input.listing.amenities, input.language).slice(0, 200);
  if (amenities.length > 0) {
    await upsertListingContent(tx, {
      workspaceId: input.workspaceId,
      propertyId: input.propertyId,
      kind: "amenities",
      items: amenities,
      language: input.language,
      source: "pms",
    });
  }
}

type ItemResult =
  | { outcome: "created" | "updated" | "needs_details"; propertyId: string }
  | { outcome: "skipped" | "failed"; reasonCode: string };

/** Creates or updates one property, inside one transaction holding the workspace's slots. */
async function importListing(
  deps: PmsImportDeps,
  input: {
    workspaceId: string;
    connectionId: string;
    provider: "beds24" | "hostex";
    startedBy: string | null;
    listing: PmsListing;
  },
): Promise<ItemResult> {
  return deps.db.transaction(async (tx) => {
    const db = tx as unknown as Database;
    const slots = await lockPropertySlots(tx, input.workspaceId);
    if (!slots) return { outcome: "failed", reasonCode: "provider_error" };
    if (slots.workspaceStatus === "pending_deletion") {
      return { outcome: "skipped", reasonCode: "workspace_pending_deletion" };
    }
    const [existing] = await tx
      .select()
      .from(property)
      .where(
        and(
          eq(property.workspaceId, input.workspaceId),
          eq(property.sourceProvider, input.provider),
          eq(property.externalId, input.listing.externalId),
          eq(property.status, "active"),
        ),
      )
      .limit(1);
    const languages = existing?.guideLanguages ?? languagesOf(input.listing);
    const imported = factsOf(input.listing, languages);

    let propertyId: string;
    let outcome: "created" | "updated" | "needs_details";
    if (existing) {
      // Facts the host changed in Guidesk are kept (FR-033).
      const edited = new Set(existing.editedFacts);
      const facts: CoreFacts = {
        name: edited.has("name") ? existing.name : imported.name,
        addressLine1: edited.has("addressLine1") ? existing.addressLine1 : imported.addressLine1,
        addressUnit: existing.addressUnit,
        city: edited.has("city") ? existing.city : imported.city,
        region: edited.has("region") ? existing.region : imported.region,
        postalCode: edited.has("postalCode") ? existing.postalCode : imported.postalCode,
        country: edited.has("country") ? existing.country : imported.country,
        timeZone: edited.has("timeZone")
          ? existing.timeZone
          : (imported.timeZone ?? existing.timeZone),
        checkInTime: edited.has("checkInTime")
          ? existing.checkInTime?.slice(0, 5)
          : imported.checkInTime,
        checkoutTime: edited.has("checkoutTime")
          ? existing.checkoutTime?.slice(0, 5)
          : imported.checkoutTime,
        maxGuests: edited.has("maxGuests") ? existing.maxGuests : imported.maxGuests,
        guideLanguages: existing.guideLanguages,
      };
      await tx
        .update(property)
        .set({
          name: facts.name ?? existing.name,
          addressLine1: facts.addressLine1 ?? null,
          city: facts.city ?? null,
          region: facts.region ?? null,
          postalCode: facts.postalCode ?? null,
          country: facts.country ?? null,
          timeZone: facts.timeZone ?? null,
          checkInTime: facts.checkInTime ?? null,
          checkoutTime: facts.checkoutTime ?? null,
          maxGuests: facts.maxGuests ?? null,
          addressKey: normalizeAddressKey(facts),
          missingFacts: missingFacts(facts),
          setupStatus: setupStatusAfterEdit(existing.setupStatus, "pms", facts),
          pmsConnectionId: input.connectionId,
          pmsStatus: "linked",
        })
        .where(eq(property.id, existing.id));
      propertyId = existing.id;
      outcome = "updated";
    } else {
      if (roomLeft(slots.limit, slots.used) === 0) {
        return { outcome: "skipped", reasonCode: "plan_limit" };
      }
      const setupStatus = initialSetupStatus("pms", imported);
      const [created] = await tx
        .insert(property)
        .values({
          workspaceId: input.workspaceId,
          name: imported.name ?? input.listing.externalId.slice(0, 120),
          addressLine1: imported.addressLine1 ?? null,
          city: imported.city ?? null,
          region: imported.region ?? null,
          postalCode: imported.postalCode ?? null,
          country: imported.country ?? null,
          addressKey: normalizeAddressKey(imported),
          timeZone: imported.timeZone ?? null,
          checkInTime: imported.checkInTime ?? null,
          checkoutTime: imported.checkoutTime ?? null,
          maxGuests: imported.maxGuests ?? null,
          guideLanguages: languages,
          setupStatus,
          missingFacts: missingFacts(imported),
          source: "pms",
          sourceProvider: input.provider,
          pmsConnectionId: input.connectionId,
          externalId: input.listing.externalId,
          pmsStatus: "linked",
          createdBy: input.startedBy,
        })
        .returning({ id: property.id });
      propertyId = created!.id;
      outcome = setupStatus === "needs_details" ? "needs_details" : "created";
      // Feature 003: the guide exists from the start (FR-001); the AI part of the draft runs when
      // the guide is first opened, so a large import spends no AI budget up front (research R16).
      await createGuideForProperty(tx, {
        workspaceId: input.workspaceId,
        propertyId,
        guideLanguages: languages,
      });
    }
    await storeContent(deps, db, {
      workspaceId: input.workspaceId,
      propertyId,
      provider: input.provider,
      listing: input.listing,
      language: languages[0] ?? "es",
    });
    return { outcome, propertyId };
  });
}

async function finishItem(
  db: Database,
  runId: string,
  itemId: string,
  label: string,
  result: ItemResult,
): Promise<void> {
  await db
    .update(importItem)
    .set({
      label: label.slice(0, 120) || "—",
      outcome: result.outcome,
      reasonCode: "reasonCode" in result ? result.reasonCode.slice(0, 40) : null,
      ...("propertyId" in result ? { propertyId: result.propertyId } : {}),
    })
    .where(eq(importItem.id, itemId));
  await db
    .update(importRun)
    .set({
      processed: sql`least(${importRun.processed} + 1, ${importRun.total})`,
      ...(result.outcome === "created" ? { created: sql`${importRun.created} + 1` } : {}),
      ...(result.outcome === "needs_details"
        ? { needsDetails: sql`${importRun.needsDetails} + 1` }
        : {}),
      ...(result.outcome === "failed" ? { failed: sql`${importRun.failed} + 1` } : {}),
      ...(result.outcome === "skipped" ? { skipped: sql`${importRun.skipped} + 1` } : {}),
    })
    .where(eq(importRun.id, runId));
}

export async function runPmsImport(
  deps: PmsImportDeps,
  job: PmsImportJob,
): Promise<PmsImportOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const [run] = await db
    .select()
    .from(importRun)
    .where(and(eq(importRun.id, job.importRunId), eq(importRun.workspaceId, job.workspaceId)))
    .limit(1);
  // Not visible yet: the request that queued it may still be committing, so pg-boss retries.
  if (!run) throw new Error("import run not found yet");
  if (run.kind !== "pms" || !run.pmsConnectionId) return "skipped";
  if (run.status !== "running") return "skipped";
  const pending = await db
    .select({ id: importItem.id, externalId: importItem.externalId, label: importItem.label })
    .from(importItem)
    .where(and(eq(importItem.importRunId, run.id), eq(importItem.outcome, "pending")))
    .orderBy(asc(importItem.label));
  const connection = await loadConnection(deps, job.workspaceId, run.pmsConnectionId);

  const failAll = async (reasonCode: string) => {
    for (const item of pending) {
      await finishItem(db, run.id, item.id, item.label, { outcome: "failed", reasonCode });
    }
  };

  let listings: PmsListing[] = [];
  let reservations: PmsReservation[] = [];
  let failure: "reconnect_pms" | "provider_error" | null = null;
  if (!connection?.credential) {
    failure = "reconnect_pms";
  } else if (pending.length > 0) {
    const adapter = deps.adapters[connection.provider];
    const today = pmsToday(now);
    try {
      listings = await adapter.listListings(connection.credential);
      const wanted = pending.map((item) => item.externalId).filter((id): id is string => !!id);
      reservations = await adapter.listReservations(connection.credential, {
        listingExternalIds: wanted,
        checkoutFrom: today,
        checkoutTo: addDays(today, STAY_WINDOW_DAYS),
      });
    } catch (error) {
      failure = error instanceof PmsCredentialError ? "reconnect_pms" : "provider_error";
      if (failure === "reconnect_pms") {
        await db
          .update(pmsConnection)
          .set({
            status: "failing",
            failingSince: connection.failingSince ?? now,
            lastErrorCode: "invalid_credential",
          })
          .where(eq(pmsConnection.id, connection.id));
      }
    }
  }

  if (failure) {
    await failAll(failure);
  } else if (connection) {
    const byId = new Map(listings.map((listing) => [listing.externalId, listing]));
    const propertyByListing = new Map<string, string>();
    for (const item of pending) {
      const listing = item.externalId ? byId.get(item.externalId) : undefined;
      if (!listing) {
        await finishItem(db, run.id, item.id, item.label, {
          outcome: "failed",
          reasonCode: "not_found_in_pms",
        });
        continue;
      }
      let result: ItemResult;
      try {
        result = await importListing(deps, {
          workspaceId: job.workspaceId,
          connectionId: connection.id,
          provider: connection.provider,
          startedBy: run.startedBy,
          listing,
        });
      } catch {
        result = { outcome: "failed", reasonCode: "provider_error" };
      }
      if ("propertyId" in result) propertyByListing.set(listing.externalId, result.propertyId);
      await finishItem(db, run.id, item.id, listing.name, result);
    }
    // Upcoming stays of the imported listings; past ones are ignored (FR-030).
    await applyReservations(db, {
      workspaceId: job.workspaceId,
      connectionId: connection.id,
      propertyByListing,
      reservations,
      today: pmsToday(now),
      fullRead: false,
      now,
    });
  }

  // Items added by a retry while this job ran are left for the job the retry queued.
  const [finished] = await db
    .update(importRun)
    .set({
      status: failure === "reconnect_pms" ? "failed" : "completed",
      finishedAt: now,
      notifiedAt: now,
    })
    .where(eq(importRun.id, run.id))
    .returning();
  const counts = await db
    .select({ outcome: importItem.outcome, reasonCode: importItem.reasonCode })
    .from(importItem)
    .where(eq(importItem.importRunId, run.id));
  const updated = counts.filter((item) => item.outcome === "updated").length;
  await recordEvent(db, {
    type: "import.finished",
    workspaceId: job.workspaceId,
    actorUserId: run.startedBy,
    targetType: "import_run",
    targetId: run.id,
    metadata: {
      kind: "pms",
      total: finished!.total,
      created: finished!.created,
      updated,
      needsDetails: finished!.needsDetails,
      failed: finished!.failed,
      skipped: finished!.skipped,
    },
  });
  const reasonCodes = counts
    .filter((item) => item.outcome === "failed" || item.outcome === "skipped")
    .map((item) => item.reasonCode ?? "provider_error");
  await notifyManagers(
    db,
    deps.queueEmail,
    job.workspaceId,
    "properties.import_finished",
    (locale) =>
      renderImportFinished(locale, {
        source: connection ? PROVIDER_NAMES[connection.provider] : "PMS",
        created: finished!.created + updated,
        needsDetails: finished!.needsDetails,
        failed: finished!.failed,
        skipped: finished!.skipped,
        reasonCodes: [...new Set(reasonCodes)].slice(0, 5),
        link: `${deps.portalUrl}/${locale}/properties/imports/${run.id}`,
      }),
  );
  return failure === "reconnect_pms" ? "failed" : "completed";
}

/** The pg-boss handler: one span per run (constitution VIII). */
export function createPmsImportHandler(deps: PmsImportDeps) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<PmsImportJob>;
      if (typeof data.importRunId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload = { importRunId: data.importRunId, workspaceId: data.workspaceId };
      await runInJobSpan(
        { queue: JOB_QUEUES.pmsImport, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await runPmsImport(deps, payload);
          span.set({ "job.outcome": outcome });
          if (outcome === "failed") span.recordFailure("reconnect_pms");
        },
        deps.span,
      );
    }
  };
}
