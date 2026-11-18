import { Inject, Injectable } from "@nestjs/common";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import type {
  AddressCheck,
  AddressCheckQuery,
  ConfirmPropertiesResult,
  CreatePropertyBody,
  DuplicateDraft,
  ListPropertiesQuery,
  PropertyDetail,
  PropertyLimits,
  PropertyList,
  PropertyRemoval,
  PropertySummary,
  RestrictedValueList,
  StartOptions,
  UpdatePropertyBody,
} from "@guidesk/contracts";
import {
  createGuideForProperty,
  countActiveProperties,
  extractionRequest,
  guide,
  guideItem,
  guideItemText,
  guideSection,
  LISTING_CONTENT_KINDS,
  listingContent,
  onboardingProfile,
  upsertListingContent,
  property,
  calendarFeed,
  restrictedValue,
  stay,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import {
  confirmedSetupStatus,
  containsRestrictedValue,
  derivePath,
  extractionLimit,
  extractionLimitKey,
  initialSetupStatus,
  isKnownTimeZone,
  JOB_QUEUES,
  missingFacts,
  normalizeAddressKey,
  orderStartOptions,
  propertyLimit,
  setupStatusAfterEdit,
  todayIn,
  type CoreFacts,
  type GuideDraftJob,
  type GuideTranslateJob,
  type PmsOption,
  type Role,
  type StartOption,
  type SupportedPms,
} from "@guidesk/domain";
import { ApiProblem } from "../common/problem.js";
import { JobQueueService } from "../jobs/job-queue.service.js";
import { API_CONFIG, type ApiConfig } from "../config/config.js";
import { DB_HANDLE } from "../database/database.module.js";
import { RequestDb } from "../database/request-db.js";
import { SecurityLogService } from "../security-log/security-log.service.js";
import { CrossTenantService } from "../tenancy/cross-tenant.js";
import { PropertyLimitService } from "./property-limit.service.js";
import { toDetail, toSummary, toTimeOfDay, type PropertyRow } from "./property-mapper.js";

/**
 * Creation paths built so far; `start-options` leaves out the others (T042). Each user story adds
 * its path here when it lands.
 */
export const AVAILABLE_START_OPTIONS: readonly StartOption[] = [
  "listing",
  "pms",
  "csv",
  "duplicate",
  "blank",
];

/** A removed property can be restored for 30 days, then it is purged (FR-045). */
const RESTORE_WINDOW_MS = 30 * 86_400_000;

const COPY_OF = { es: "Copia de", en: "Copy of" } as const;

/** The typed name matches the property's name, ignoring spaces around it (FR-044). */
function sameName(typed: string | undefined, name: string): boolean {
  return (typed ?? "").normalize("NFC").trim() === name.normalize("NFC").trim();
}

const CORE_FACT_KEYS = [
  "name",
  "addressLine1",
  "addressUnit",
  "city",
  "region",
  "postalCode",
  "country",
  "timeZone",
  "checkInTime",
  "checkoutTime",
  "maxGuests",
  "guideLanguages",
] as const;

/** Feeds of the property, read through the view every member may use (FR-006, FR-025). */
const calendarStatusSql = sql<PropertySummary["calendarStatus"]>`(
  SELECT CASE WHEN count(*) = 0 THEN 'none' WHEN bool_or(f.status = 'failing') THEN 'failing' ELSE 'ok' END
  FROM calendar_feed_public f WHERE f.property_id = ${property.id}
)`;

interface Caller {
  userId: string;
  role: Role;
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as [
      string,
      string,
    ];
    const date = new Date(createdAt);
    if (Number.isNaN(date.getTime()) || typeof id !== "string") throw new Error("bad cursor");
    return { createdAt: date, id };
  } catch {
    throw new ApiProblem(422, "validation_failed", "Invalid cursor.", {
      fields: { cursor: ["Invalid"] },
    });
  }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function assertKnownTimeZone(zone: string | null | undefined): void {
  if (zone && !isKnownTimeZone(zone)) {
    throw new ApiProblem(422, "validation_failed", "Unknown time zone.", {
      fields: { timeZone: ["Choose a time zone from the list"] },
    });
  }
}

/** Properties: list, limits, start options, create, read, edit, address check (US1, T042). */
@Injectable()
export class PropertiesService {
  constructor(
    private readonly requestDb: RequestDb,
    private readonly limits: PropertyLimitService,
    private readonly crossTenant: CrossTenantService,
    private readonly securityLog: SecurityLogService,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    private readonly jobs: JobQueueService,
  ) {}

  async list(
    caller: Caller,
    workspaceId: string,
    query: ListPropertiesQuery,
  ): Promise<PropertyList> {
    if (query.status === "removed" && caller.role === "agent") {
      throw new ApiProblem(403, "forbidden", "Your role does not allow this action.");
    }
    const conditions: SQL[] = [
      eq(property.workspaceId, workspaceId),
      eq(property.status, query.status),
    ];
    if (query.query) conditions.push(ilike(property.name, `%${escapeLike(query.query)}%`));
    if (query.cursor) {
      const cursor = decodeCursor(query.cursor);
      const after = or(
        lt(property.createdAt, cursor.createdAt),
        and(eq(property.createdAt, cursor.createdAt), lt(property.id, cursor.id)),
      );
      if (after) conditions.push(after);
    }
    const rows = await this.requestDb
      .current()
      .select({
        id: property.id,
        name: property.name,
        setupStatus: property.setupStatus,
        missingFacts: property.missingFacts,
        source: property.source,
        sourceProvider: property.sourceProvider,
        pmsStatus: property.pmsStatus,
        status: property.status,
        createdAt: property.createdAt,
        purgeAfter: property.purgeAfter,
        calendarStatus: calendarStatusSql,
        guideStatus: guide.status,
        guideChanges: guide.hasUnpublishedChanges,
        guideCompleteness: guide.completeness,
      })
      .from(property)
      .leftJoin(guide, eq(guide.propertyId, property.id))
      .where(and(...conditions))
      .orderBy(desc(property.createdAt), desc(property.id))
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      items: page.map((row) => ({
        ...toSummary(row, row.calendarStatus),
        guide: row.guideStatus
          ? {
              status: row.guideStatus,
              hasUnpublishedChanges: row.guideChanges ?? false,
              completeness: row.guideCompleteness ?? 0,
            }
          : null,
      })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    };
  }

  async limitsOf(workspaceId: string): Promise<PropertyLimits> {
    const tx = this.requestDb.current();
    const [row] = await tx
      .select({ propertyLimit: workspace.propertyLimit })
      .from(workspace)
      .where(eq(workspace.id, workspaceId))
      .limit(1);
    const limit = propertyLimit(row?.propertyLimit);
    const used = await countActiveProperties(tx, workspaceId);
    // The rate-limit table is system-only (feature 001 migration 0008).
    const counted = await this.handle.db.execute<{ count: number }>(
      sql`SELECT coalesce(sum(count), 0)::int AS count FROM rate_limit_bucket WHERE key = ${extractionLimitKey(workspaceId, new Date())}`,
    );
    return {
      limit,
      used,
      extractionLimit: extractionLimit(limit),
      extractionsUsedToday: Number(counted.rows[0]?.count ?? 0),
    };
  }

  async startOptions(caller: Caller, workspaceId: string): Promise<StartOptions> {
    const tx = this.requestDb.current();
    const [answers] = await tx
      .select({ propertiesBucket: onboardingProfile.propertiesBucket, pms: onboardingProfile.pms })
      .from(onboardingProfile)
      .where(eq(onboardingProfile.userId, caller.userId))
      .limit(1);
    const flags = this.config.integrations.flags;
    const enabledProviders: SupportedPms[] = [
      ...(flags.pmsBeds24 ? (["beds24"] as const) : []),
      ...(flags.pmsHostex ? (["hostex"] as const) : []),
    ];
    const options = orderStartOptions({
      path: derivePath({
        propertiesBucket: answers?.propertiesBucket ?? null,
        pms: (answers?.pms as PmsOption | null) ?? null,
      }),
      pms: (answers?.pms as PmsOption | null) ?? null,
      enabledProviders,
      hasProperties: (await countActiveProperties(tx, workspaceId)) > 0,
      available: AVAILABLE_START_OPTIONS,
    });
    return {
      options,
      screenshotsEnabled: flags.extractionScreenshots,
      pmsProviders: AVAILABLE_START_OPTIONS.includes("pms") ? enabledProviders : [],
    };
  }

  /**
   * Creation from the confirmation step (FR-004): blank (US1), listing text with the content
   * items the host accepted from an extraction (US2, T060), or a duplicate (US6, T116), whose
   * content is copied from the source property here, never taken from the request.
   */
  async create(
    caller: Caller,
    workspaceId: string,
    body: CreatePropertyBody,
  ): Promise<PropertyDetail> {
    assertKnownTimeZone(body.timeZone);
    const tx = this.requestDb.current();
    const extraction =
      body.source === "listing_text"
        ? await this.acceptedExtraction(caller, workspaceId, body)
        : null;
    let original: PropertyRow | null = null;
    if (body.source === "duplicate") {
      if (body.contentItems?.length) {
        throw new ApiProblem(
          422,
          "validation_failed",
          "A copy takes its content from the original.",
          {
            fields: { contentItems: ["Not accepted for a duplicate"] },
          },
        );
      }
      original = await this.loadActive(caller, workspaceId, body.duplicateOf!);
    }
    await this.limits.withCreationSlot(tx, workspaceId, 1);
    const facts = factsOf(body);
    const [row] = await tx
      .insert(property)
      .values({
        workspaceId,
        name: body.name,
        addressLine1: body.addressLine1,
        addressUnit: body.addressUnit ?? null,
        city: body.city,
        region: body.region ?? null,
        postalCode: body.postalCode ?? null,
        country: body.country,
        timeZone: body.timeZone,
        checkInTime: body.checkInTime,
        checkoutTime: body.checkoutTime,
        maxGuests: body.maxGuests,
        guideLanguages: body.guideLanguages,
        addressKey: normalizeAddressKey(facts),
        setupStatus: initialSetupStatus(body.source, facts),
        missingFacts: missingFacts(facts),
        source: body.source,
        duplicatedFromId: original?.id ?? null,
        createdBy: caller.userId,
      })
      .returning();
    // Feature 003: every property starts with its guide (FR-001, research R16).
    const newGuide = await createGuideForProperty(tx, {
      workspaceId,
      propertyId: row!.id,
      guideLanguages: row!.guideLanguages,
    });
    if (original) {
      // The listing content, labeled as copied until the host edits or approves it (FR-043).
      for (const item of await this.contentOf(original.id)) {
        await upsertListingContent(tx, {
          workspaceId,
          propertyId: row!.id,
          kind: item.kind,
          body: item.body,
          items: item.items,
          language: item.language,
          source: "duplicate",
        });
      }
    }
    if (extraction) {
      // Content keeps its source label until the host edits or approves it (FR-018).
      const source = extraction.inputText ? "listing_text" : "screenshot";
      for (const item of body.contentItems ?? []) {
        await upsertListingContent(tx, {
          workspaceId,
          propertyId: row!.id,
          kind: item.kind,
          body: item.body ?? null,
          items: item.items ?? null,
          language: item.language ?? null,
          source,
          extractionRequestId: extraction.id,
          editedBy: item.edited ? caller.userId : null,
        });
      }
      // The pasted and recognized text are no longer needed once the property exists (data model §6).
      await tx
        .update(extractionRequest)
        .set({
          propertyId: row!.id,
          inputText: null,
          recognizedText: null,
          inputDeletedAt: new Date(),
        })
        .where(eq(extractionRequest.id, extraction.id));
    }
    // The AI part of the draft runs in the worker once this transaction has committed (research
    // R16); `startAfter` leaves it time, and the job retries if the guide is not visible yet.
    await this.jobs.send(
      JOB_QUEUES.guideDraft,
      { guideId: newGuide.guideId, workspaceId } satisfies GuideDraftJob,
      { startAfter: 2, retryLimit: 3, retryBackoff: true, singletonKey: newGuide.guideId },
    );
    return this.detail(caller, row!);
  }

  /** The finished extraction behind a listing-text creation, with the host's items checked again. */
  private async acceptedExtraction(caller: Caller, workspaceId: string, body: CreatePropertyBody) {
    const extractionId = body.extractionRequestId!;
    const [extraction] = await this.requestDb
      .current()
      .select({
        id: extractionRequest.id,
        status: extractionRequest.status,
        propertyId: extractionRequest.propertyId,
        inputText: extractionRequest.inputText,
      })
      .from(extractionRequest)
      .where(
        and(eq(extractionRequest.id, extractionId), eq(extractionRequest.workspaceId, workspaceId)),
      )
      .limit(1);
    if (!extraction) {
      throw await this.crossTenant.notFound(
        caller.userId,
        workspaceId,
        "extraction_request",
        extractionId,
      );
    }
    if (extraction.status !== "succeeded" || extraction.propertyId) {
      throw new ApiProblem(409, "conflict", "This extraction cannot create a property.");
    }
    for (const [index, item] of (body.contentItems ?? []).entries()) {
      const text = [item.body ?? "", ...(item.items ?? [])].join("\n");
      if (containsRestrictedValue(text)) {
        throw new ApiProblem(
          422,
          "validation_failed",
          "This looks like a code. Add codes in the guide's locked fields instead.",
          { fields: { [`contentItems.${index}`]: ["restricted_value"] } },
        );
      }
    }
    return extraction;
  }

  async get(caller: Caller, workspaceId: string, propertyId: string): Promise<PropertyDetail> {
    return this.detail(caller, await this.load(caller, workspaceId, propertyId));
  }

  async update(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    body: UpdatePropertyBody,
  ): Promise<PropertyDetail> {
    const current = await this.loadActive(caller, workspaceId, propertyId);
    assertKnownTimeZone(body.timeZone);
    const facts: CoreFacts = { ...factsOf(current), ...body };
    const changed = CORE_FACT_KEYS.filter(
      (key) => key in body && !sameFact(currentFact(current, key), body[key]),
    );
    const imported = current.source === "csv" || current.source === "pms";
    const editedFacts = imported
      ? [...new Set([...current.editedFacts, ...changed])].sort()
      : current.editedFacts;
    const [row] = await this.requestDb
      .current()
      .update(property)
      .set({
        ...body,
        addressKey: normalizeAddressKey(facts),
        setupStatus: setupStatusAfterEdit(current.setupStatus, current.source, facts),
        missingFacts: missingFacts(facts),
        editedFacts,
      })
      .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
      .returning();
    if (!row)
      throw await this.crossTenant.notFound(caller.userId, workspaceId, "property", propertyId);
    if (body.guideLanguages) {
      await this.guideLanguagesChanged(
        workspaceId,
        propertyId,
        current.guideLanguages,
        row.guideLanguages,
      );
    }
    return this.detail(caller, row);
  }

  /**
   * Guide languages changed (FR-048): a removed language leaves the draft (published versions keep
   * it until the next publish), and an added one is translated for every section.
   */
  private async guideLanguagesChanged(
    workspaceId: string,
    propertyId: string,
    before: readonly ("es" | "en")[],
    after: readonly ("es" | "en")[],
  ): Promise<void> {
    const removed = before.filter((language) => !after.includes(language));
    const added = after.filter((language) => !before.includes(language));
    if (removed.length === 0 && added.length === 0) return;
    const tx = this.requestDb.current();
    const [row] = await tx
      .select({ id: guide.id })
      .from(guide)
      .where(eq(guide.propertyId, propertyId))
      .limit(1);
    if (!row) return;
    const items = await tx
      .select({
        id: guideItem.id,
        sectionId: guideItem.sectionId,
        sourceLanguage: guideItem.sourceLanguage,
      })
      .from(guideItem)
      .innerJoin(guideSection, eq(guideSection.id, guideItem.sectionId))
      .where(and(eq(guideSection.guideId, row.id), ne(guideItem.kind, "fact")));
    for (const language of removed) {
      // An item written in the removed language keeps its source text.
      const translated = items
        .filter((item) => item.sourceLanguage !== language)
        .map((item) => item.id);
      if (translated.length > 0) {
        await tx
          .delete(guideItemText)
          .where(
            and(eq(guideItemText.language, language), inArray(guideItemText.itemId, translated)),
          );
      }
    }
    if (after.length < 2 || added.length === 0 || items.length === 0) return;
    const sources = await tx
      .select({ itemId: guideItemText.itemId, language: guideItemText.language })
      .from(guideItemText)
      .where(
        and(
          inArray(
            guideItemText.itemId,
            items.map((item) => item.id),
          ),
          isNotNull(guideItemText.doc),
        ),
      );
    const sections = new Set<string>();
    for (const language of added) {
      for (const item of items) {
        if (item.sourceLanguage === language) continue;
        if (
          !sources.some((text) => text.itemId === item.id && text.language === item.sourceLanguage)
        ) {
          continue;
        }
        await tx
          .insert(guideItemText)
          .values({
            itemId: item.id,
            language,
            workspaceId,
            doc: null,
            origin: "machine",
            state: "stale",
          })
          .onConflictDoNothing();
        if (item.sectionId) sections.add(`${item.sectionId}:${language}`);
      }
    }
    for (const key of sections) {
      const [sectionId, language] = key.split(":") as [string, "es" | "en"];
      await this.jobs.send(
        JOB_QUEUES.guideTranslate,
        { workspaceId, sectionId, language } satisfies GuideTranslateJob,
        { startAfter: 1, singletonKey: key, retryLimit: 3, retryBackoff: true },
      );
    }
  }

  async addressCheck(workspaceId: string, query: AddressCheckQuery): Promise<AddressCheck> {
    const key = normalizeAddressKey({
      addressLine1: query.line1,
      addressUnit: query.unit ?? null,
      city: query.city,
      country: query.country,
    });
    if (!key) return { matches: [] };
    const rows = await this.requestDb
      .current()
      .select({ propertyId: property.id, name: property.name })
      .from(property)
      .where(
        and(
          eq(property.workspaceId, workspaceId),
          eq(property.status, "active"),
          eq(property.addressKey, key),
        ),
      )
      .orderBy(property.createdAt);
    return { matches: rows };
  }

  /** A property the caller can see in this workspace, or the same 404 for anything else. */
  /**
   * "Confirm all" (FR-004, T094): imported properties in `to_confirm` become `ready`; any still
   * missing a fact are returned as `needs_details`. Other properties are left as they are.
   */
  async confirm(
    workspaceId: string,
    propertyIds: readonly string[],
  ): Promise<ConfirmPropertiesResult> {
    const tx = this.requestDb.current();
    const rows = await tx
      .select()
      .from(property)
      .where(
        and(
          eq(property.workspaceId, workspaceId),
          eq(property.status, "active"),
          inArray(property.id, [...new Set(propertyIds)]),
        ),
      );
    const result: ConfirmPropertiesResult = { ready: [], needsDetails: [] };
    for (const row of rows) {
      const status =
        row.setupStatus === "to_confirm" ? confirmedSetupStatus(factsOf(row)) : row.setupStatus;
      if (row.setupStatus === "to_confirm") {
        await tx
          .update(property)
          .set({ setupStatus: status, missingFacts: missingFacts(factsOf(row)) })
          .where(eq(property.id, row.id));
      }
      if (status === "ready") result.ready.push(row.id);
      else if (status === "needs_details") {
        result.needsDetails.push({ propertyId: row.id, missingFacts: missingFacts(factsOf(row)) });
      }
    }
    return result;
  }

  /** Codes found in imported PMS text, masked: kind and label only (FR-031, T100). */
  async restrictedValues(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
  ): Promise<RestrictedValueList> {
    await this.load(caller, workspaceId, propertyId);
    const rows = await this.requestDb
      .current()
      .select({
        id: restrictedValue.id,
        kind: restrictedValue.kind,
        label: restrictedValue.label,
        createdAt: restrictedValue.createdAt,
      })
      .from(restrictedValue)
      .where(eq(restrictedValue.propertyId, propertyId))
      .orderBy(restrictedValue.createdAt);
    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        label: row.label,
        source: "pms" as const,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * The confirmation step's prefill for a copy (FR-043, T116): facts without the address, and the
   * listing content. Feeds, stays, codes, and the PMS link stay with the original.
   */
  async duplicateDraft(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    language: "es" | "en",
  ): Promise<DuplicateDraft> {
    const original = await this.loadActive(caller, workspaceId, propertyId);
    return {
      duplicateOf: original.id,
      sourceName: original.name,
      name: `${COPY_OF[language]} ${original.name}`.slice(0, 120),
      country: original.country,
      timeZone: original.timeZone,
      checkInTime: toTimeOfDay(original.checkInTime),
      checkoutTime: toTimeOfDay(original.checkoutTime),
      maxGuests: original.maxGuests,
      guideLanguages: original.guideLanguages,
      content: await this.contentOf(original.id),
    };
  }

  /** Listing content in the order the property page shows it. */
  private async contentOf(propertyId: string) {
    const rows = await this.requestDb
      .current()
      .select({
        kind: listingContent.kind,
        body: listingContent.body,
        items: listingContent.items,
        language: listingContent.language,
      })
      .from(listingContent)
      .where(eq(listingContent.propertyId, propertyId));
    return rows.sort(
      (a, b) => LISTING_CONTENT_KINDS.indexOf(a.kind) - LISTING_CONTENT_KINDS.indexOf(b.kind),
    );
  }

  /**
   * Removes a property for 30 days (FR-044, FR-045, T117), after the typed name and a recent
   * sign-in. With `dryRun`, it only lists the upcoming stays to warn about. A removed property
   * does not count toward the limit, and its feeds and PMS refreshes stop.
   */
  async remove(
    caller: Caller,
    workspaceId: string,
    propertyId: string,
    input: { typedName?: string; dryRun: boolean },
  ): Promise<PropertyRemoval> {
    const row = await this.loadActive(caller, workspaceId, propertyId);
    const tx = this.requestDb.current();
    const now = new Date();
    const upcomingStays = await tx
      .select({
        checkInDate: stay.checkInDate,
        checkoutDate: stay.checkoutDate,
        channel: stay.channel,
      })
      .from(stay)
      .where(
        and(
          eq(stay.propertyId, propertyId),
          eq(stay.status, "active"),
          isNull(stay.duplicateOfId),
          gte(stay.checkoutDate, todayIn(row.timeZone ?? "UTC", now)),
        ),
      )
      .orderBy(asc(stay.checkInDate), asc(stay.checkoutDate));
    if (input.dryRun) return { removed: false, purgeAfter: null, upcomingStays };
    if (!sameName(input.typedName, row.name)) {
      throw new ApiProblem(409, "confirmation_mismatch");
    }
    const purgeAfter = new Date(now.getTime() + RESTORE_WINDOW_MS);
    const [removed] = await tx
      .update(property)
      .set({ status: "removed", removedAt: now, removedBy: caller.userId, purgeAfter })
      .where(and(eq(property.id, propertyId), eq(property.status, "active")))
      .returning({ id: property.id });
    if (!removed) throw new ApiProblem(404, "not_found");
    await this.securityLog.record({
      type: "property.removed",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "property",
      targetId: propertyId,
      metadata: {},
    });
    return { removed: true, purgeAfter: purgeAfter.toISOString(), upcomingStays };
  }

  /** Restores a removed property within 30 days, when the plan has a free slot (FR-045, T117). */
  async restore(caller: Caller, workspaceId: string, propertyId: string): Promise<PropertyDetail> {
    const current = await this.load(caller, workspaceId, propertyId);
    if (current.status !== "removed") {
      throw new ApiProblem(409, "conflict", "This property is not removed.");
    }
    if (current.purgeAfter && current.purgeAfter.getTime() <= Date.now()) {
      throw new ApiProblem(410, "gone", "This property can no longer be restored.");
    }
    const tx = this.requestDb.current();
    await this.limits.withCreationSlot(tx, workspaceId, 1);
    const [row] = await tx
      .update(property)
      .set({ status: "active", removedAt: null, removedBy: null, purgeAfter: null })
      .where(and(eq(property.id, propertyId), eq(property.status, "removed")))
      .returning();
    if (!row) throw new ApiProblem(409, "conflict", "This property is not removed.");
    await this.securityLog.record({
      type: "property.restored",
      outcome: "success",
      actorUserId: caller.userId,
      workspaceId,
      targetType: "property",
      targetId: propertyId,
      metadata: {},
    });
    return this.detail(caller, row);
  }

  /** An active property of this workspace; a removed one is `404`, like one that does not exist. */
  async loadActive(caller: Caller, workspaceId: string, propertyId: string): Promise<PropertyRow> {
    const row = await this.load(caller, workspaceId, propertyId);
    if (row.status !== "active") throw new ApiProblem(404, "not_found");
    return row;
  }

  async load(caller: Caller, workspaceId: string, propertyId: string): Promise<PropertyRow> {
    const [row] = await this.requestDb
      .current()
      .select()
      .from(property)
      .where(and(eq(property.id, propertyId), eq(property.workspaceId, workspaceId)))
      .limit(1);
    if (!row)
      throw await this.crossTenant.notFound(caller.userId, workspaceId, "property", propertyId);
    return row;
  }

  private async detail(caller: Caller, row: PropertyRow): Promise<PropertyDetail> {
    const tx = this.requestDb.current();
    const manager = caller.role === "owner" || caller.role === "admin";
    const [stays] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(stay)
      .where(eq(stay.propertyId, row.id));
    const [status] = await tx
      .select({ value: calendarStatusSql })
      .from(property)
      .where(eq(property.id, row.id));
    let feeds: number | null = null;
    let restrictedValues: number | null = null;
    if (manager) {
      const [feedCount] = await tx
        .select({ count: sql<number>`count(${calendarFeed.id})::int` })
        .from(calendarFeed)
        .where(eq(calendarFeed.propertyId, row.id));
      const [valueCount] = await tx
        .select({ count: sql<number>`count(${restrictedValue.id})::int` })
        .from(restrictedValue)
        .where(eq(restrictedValue.propertyId, row.id));
      feeds = feedCount?.count ?? 0;
      restrictedValues = valueCount?.count ?? 0;
    }
    return toDetail(row, status?.value ?? "none", {
      stays: stays?.count ?? 0,
      feeds,
      restrictedValues,
    });
  }
}

function factsOf(source: CoreFacts | PropertyRow): Required<CoreFacts> {
  return {
    name: source.name ?? null,
    addressLine1: source.addressLine1 ?? null,
    addressUnit: source.addressUnit ?? null,
    city: source.city ?? null,
    region: source.region ?? null,
    postalCode: source.postalCode ?? null,
    country: source.country ?? null,
    timeZone: source.timeZone ?? null,
    checkInTime: toTimeOfDay(source.checkInTime ?? null),
    checkoutTime: toTimeOfDay(source.checkoutTime ?? null),
    maxGuests: source.maxGuests ?? null,
    guideLanguages: source.guideLanguages ?? null,
  };
}

function currentFact(row: PropertyRow, key: (typeof CORE_FACT_KEYS)[number]): unknown {
  return factsOf(row)[key];
}

function sameFact(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}
