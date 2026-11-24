import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import {
  createGuideForProperty,
  calendarFeed,
  importItem,
  importRun,
  lockPropertySlots,
  property,
  stay,
  upload,
  type Database,
} from "@guidesk/db";
import {
  csvCells,
  detectChannel,
  feedChannelName,
  feedDisplayHint,
  flagCsvDuplicates,
  initialSetupStatus,
  isBlankCsvRow,
  JOB_QUEUES,
  missingFacts,
  normalizeAddressKey,
  normalizeFeedUrl,
  planFeedRefresh,
  roomLeft,
  readCsvHeader,
  todayIn,
  validateCsvRow,
  type CsvIssue,
  type CsvRow,
} from "@guidesk/domain";
import { renderImportFinished } from "@guidesk/emails";
import type { EmailMessage, SandboxPort } from "@guidesk/integrations";
import { createDataKeyStore, type Vault } from "@guidesk/vault";
import type { VaultDecrypter } from "@guidesk/vault/decrypt";
import { notifyManagers } from "../notify.js";
import { recordEvent } from "./pms-common.js";
import { runInJobSpan, type JobSpanDeps } from "./span.js";

/**
 * CSV import (feature 002 US5, FR-037 to FR-042, research R10, T110).
 *
 * `csv.validate` parses the uploaded file in the sandbox, which deletes it, and validates every
 * row before anything is created. Each row becomes an `import_item` with its values, never its
 * calendar link: a link with a valid format is kept encrypted until the property exists.
 *
 * `csv.import` creates the chosen rows within the free slots, then reads each calendar link
 * through the same isolated feed reader as the portal. A link rejected then is an error on its
 * column; either way the item's link is set to null.
 */
export interface CsvJob {
  importRunId: string;
  workspaceId: string;
}

export interface CsvJobDeps {
  db: Database;
  sandbox: SandboxPort;
  vault: Vault;
  decrypter: VaultDecrypter;
  /** HMAC of a normalized calendar link with the feed pepper, as the API computes it (FR-020). */
  fingerprint: (normalizedUrl: string) => string;
  queueEmail: (message: EmailMessage) => Promise<void>;
  portalUrl: string;
  now?: () => Date;
  span?: JobSpanDeps;
}

const ROW_LABEL = { es: "Fila", en: "Row" } as const;
/** Items inserted per statement. */
const INSERT_CHUNK = 100;

async function loadRun(db: Database, job: CsvJob) {
  const [run] = await db
    .select()
    .from(importRun)
    .where(and(eq(importRun.id, job.importRunId), eq(importRun.workspaceId, job.workspaceId)))
    .limit(1);
  // Not visible yet: the request that queued it may still be committing, so pg-boss retries.
  if (!run) throw new Error("import run not found yet");
  return run;
}

export type CsvValidateOutcome = "skipped" | "validated" | "failed";

export async function runCsvValidate(deps: CsvJobDeps, job: CsvJob): Promise<CsvValidateOutcome> {
  const { db } = deps;
  const now = deps.now?.() ?? new Date();
  const run = await loadRun(db, job);
  if (run.kind !== "csv" || run.status !== "validating") return "skipped";

  const [file] = run.uploadId
    ? await db.select().from(upload).where(eq(upload.id, run.uploadId)).limit(1)
    : [];
  const fail = async (reason: string): Promise<"failed"> => {
    if (file) {
      await db
        .update(upload)
        .set({ status: "deleted", deletedAt: file.deletedAt ?? now, rejectReason: reason })
        .where(eq(upload.id, file.id));
    }
    await db
      .update(importRun)
      .set({ status: "failed", finishedAt: now })
      .where(eq(importRun.id, run.id));
    return "failed";
  };
  if (!file || file.status === "deleted") return fail("not_found");

  // The file processor deletes the object whatever the outcome (data model §6).
  const response = await deps.sandbox.processFile({ objectKey: file.objectKey, purpose: "csv" });
  await db
    .update(upload)
    .set({ status: "deleted", deletedAt: now, rejectReason: null })
    .where(eq(upload.id, file.id));
  file.deletedAt = now;
  if ("error" in response) return fail(response.error);
  if (!("rows" in response)) return fail("internal");

  const [header, ...data] = response.rows;
  if (!header) return fail("no_rows");
  const columns = readCsvHeader(header);
  if (!columns.ok) return fail(columns.error);

  const rows: CsvRow[] = [];
  data.forEach((cells, index) => {
    const mapped = csvCells(cells, columns.columns);
    if (isBlankCsvRow(mapped)) return;
    rows.push(
      validateCsvRow(response.rowNumbers[index + 1] ?? index + 2, mapped, columns.language),
    );
  });
  if (rows.length === 0) return fail("no_rows");

  const existing = await db
    .select({ name: property.name, addressKey: property.addressKey })
    .from(property)
    .where(and(eq(property.workspaceId, job.workspaceId), eq(property.status, "active")));
  const flagged = flagCsvDuplicates(rows, existing);

  await db.transaction(async (tx) => {
    const keys = createDataKeyStore(tx);
    const values: (typeof importItem.$inferInsert)[] = [];
    for (const row of flagged) {
      const id = randomUUID();
      // A row that cannot be created keeps no link: nothing will ever read it.
      const link =
        row.creatable && row.calendarUrl
          ? await deps.vault.encrypt(
              keys,
              {
                workspaceId: job.workspaceId,
                table: "import_item",
                column: "calendar_url_ciphertext",
                rowId: id,
              },
              row.calendarUrl,
            )
          : null;
      values.push({
        id,
        workspaceId: job.workspaceId,
        importRunId: run.id,
        rowNumber: row.rowNumber,
        label: (row.facts.name ?? `${ROW_LABEL[columns.language]} ${row.rowNumber}`).slice(0, 120),
        selected: row.creatable,
        outcome: row.creatable ? "pending" : "failed",
        reasonCode: row.creatable ? null : "invalid_row",
        errors: row.errors as { column: string; code: string }[],
        warnings: row.warnings,
        rowValues: row.values,
        calendarUrlCiphertext: link?.ciphertext ?? null,
        dataKeyId: link?.dataKeyId ?? null,
      });
    }
    for (let start = 0; start < values.length; start += INSERT_CHUNK) {
      await tx.insert(importItem).values(values.slice(start, start + INSERT_CHUNK));
    }
    const invalid = flagged.filter((row) => !row.creatable).length;
    await tx
      .update(importRun)
      .set({
        status: "awaiting_confirmation",
        total: flagged.length,
        processed: invalid,
        failed: invalid,
      })
      .where(eq(importRun.id, run.id));
  });
  return "validated";
}

type ItemRow = typeof importItem.$inferSelect;

type RowResult =
  | { outcome: "created" | "needs_details"; propertyId: string; timeZone: string | null }
  | { outcome: "skipped" | "failed"; reasonCode: string };

/** Creates one row's property inside one transaction holding the workspace's slots. */
async function createRow(
  deps: CsvJobDeps,
  input: { workspaceId: string; startedBy: string | null; item: ItemRow },
): Promise<RowResult> {
  return deps.db.transaction(async (tx) => {
    const slots = await lockPropertySlots(tx, input.workspaceId);
    if (!slots) return { outcome: "failed", reasonCode: "internal" };
    if (slots.workspaceStatus === "pending_deletion") {
      return { outcome: "skipped", reasonCode: "workspace_pending_deletion" };
    }
    if (roomLeft(slots.limit, slots.used) === 0) {
      return { outcome: "skipped", reasonCode: "plan_limit" };
    }
    // The stored values are already normalized, so validating them again gives the same facts.
    const row = validateCsvRow(input.item.rowNumber ?? 0, input.item.rowValues ?? {}, "es");
    if (!row.creatable || !row.facts.name) return { outcome: "failed", reasonCode: "invalid_row" };
    const facts = row.facts;
    const setupStatus = initialSetupStatus("csv", facts);
    const [created] = await tx
      .insert(property)
      .values({
        workspaceId: input.workspaceId,
        name: facts.name!,
        addressLine1: facts.addressLine1 ?? null,
        addressUnit: facts.addressUnit ?? null,
        city: facts.city ?? null,
        region: facts.region ?? null,
        postalCode: facts.postalCode ?? null,
        country: facts.country ?? null,
        addressKey: normalizeAddressKey(facts),
        timeZone: facts.timeZone ?? null,
        checkInTime: facts.checkInTime ?? null,
        checkoutTime: facts.checkoutTime ?? null,
        maxGuests: facts.maxGuests ?? null,
        guideLanguages: [...(facts.guideLanguages ?? ["es", "en"])],
        setupStatus,
        missingFacts: missingFacts(facts),
        source: "csv",
        createdBy: input.startedBy,
      })
      .returning({ id: property.id });
    // Feature 003: the guide and its sections exist from the start (FR-001); the AI part of the
    // draft runs the first time the guide is opened (research R16).
    await createGuideForProperty(tx, {
      workspaceId: input.workspaceId,
      propertyId: created!.id,
      guideLanguages: [...(facts.guideLanguages ?? ["es", "en"])],
    });
    return {
      outcome: setupStatus === "needs_details" ? "needs_details" : "created",
      propertyId: created!.id,
      timeZone: facts.timeZone ?? null,
    };
  });
}

/** The label of a feed on another channel: the link's host, which carries no token. */
function hostLabel(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "").slice(0, 40) || "iCal";
}

/**
 * Reads a row's calendar link through the feed reader and saves the feed with its stays, as the
 * portal does (FR-020 to FR-026). Returns false when the link is rejected; nothing is stored then.
 */
async function saveFeed(
  deps: CsvJobDeps,
  input: {
    workspaceId: string;
    propertyId: string;
    timeZone: string | null;
    startedBy: string | null;
    item: ItemRow;
  },
): Promise<boolean> {
  const { db } = deps;
  const { item } = input;
  if (!item.calendarUrlCiphertext || !item.dataKeyId) return false;
  try {
    const url = await deps.decrypter.decryptText(
      createDataKeyStore(db),
      {
        workspaceId: input.workspaceId,
        table: "import_item",
        column: "calendar_url_ciphertext",
        rowId: item.id,
        dataKeyId: item.dataKeyId,
      },
      item.calendarUrlCiphertext,
    );
    const normalized = normalizeFeedUrl(url);
    if (!normalized) return false;
    const read = await deps.sandbox.readFeed({ url });
    if (!("entries" in read)) return false;

    const now = deps.now?.() ?? new Date();
    const channel = detectChannel(url);
    const label = channel === "other" ? hostLabel(url) : null;
    const feedId = randomUUID();
    await db.transaction(async (tx) => {
      const { ciphertext, dataKeyId } = await deps.vault.encrypt(
        createDataKeyStore(tx),
        {
          workspaceId: input.workspaceId,
          table: "calendar_feed",
          column: "url_ciphertext",
          rowId: feedId,
        },
        url,
      );
      await tx.insert(calendarFeed).values({
        id: feedId,
        workspaceId: input.workspaceId,
        propertyId: input.propertyId,
        channel,
        channelLabel: label,
        urlCiphertext: ciphertext,
        urlFingerprint: deps.fingerprint(normalized),
        displayHint: feedDisplayHint(url),
        dataKeyId,
        lastSuccessAt: now,
        lastAttemptAt: now,
        etag: read.etag,
        lastModified: read.lastModified,
        createdBy: input.startedBy,
      });
      const plan = planFeedRefresh({
        today: todayIn(input.timeZone ?? "UTC", now),
        existing: [],
        entries: read.entries,
      });
      if (plan.create.length > 0) {
        await tx.insert(stay).values(
          plan.create.map((entry) => ({
            workspaceId: input.workspaceId,
            propertyId: input.propertyId,
            source: "ical" as const,
            calendarFeedId: feedId,
            externalUid: entry.externalUid,
            checkInDate: entry.checkInDate,
            checkoutDate: entry.checkoutDate,
            channel: feedChannelName(channel, label),
            mayBeBlock: entry.mayBeBlock,
            bookingReference: entry.bookingReference,
            lastSeenAt: now,
          })),
        );
      }
    });
    await recordEvent(db, {
      type: "calendar_feed.added",
      workspaceId: input.workspaceId,
      actorUserId: input.startedBy,
      targetType: "calendar_feed",
      targetId: feedId,
      metadata: { channel },
    });
    return true;
  } catch {
    // Decryption or storage failed: the property keeps no feed, as for a rejected link. The
    // error is dropped unread, because it could quote the link.
    return false;
  }
}

async function finishItem(
  db: Database,
  runId: string,
  item: ItemRow,
  result: RowResult,
  extraErrors: CsvIssue[],
): Promise<void> {
  await db
    .update(importItem)
    .set({
      outcome: result.outcome,
      reasonCode: "reasonCode" in result ? result.reasonCode.slice(0, 40) : null,
      ...("propertyId" in result ? { propertyId: result.propertyId } : {}),
      errors: [...item.errors, ...(extraErrors as { column: string; code: string }[])],
      // Saved or rejected, the link is no longer kept (data model §6).
      calendarUrlCiphertext: null,
      dataKeyId: null,
    })
    .where(eq(importItem.id, item.id));
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

export type CsvImportOutcome = "skipped" | "completed";

export async function runCsvImport(deps: CsvJobDeps, job: CsvJob): Promise<CsvImportOutcome> {
  const { db } = deps;
  const run = await loadRun(db, job);
  if (run.kind !== "csv" || run.status !== "running") return "skipped";
  const pending = await db
    .select()
    .from(importItem)
    .where(
      and(
        eq(importItem.importRunId, run.id),
        eq(importItem.outcome, "pending"),
        eq(importItem.selected, true),
      ),
    )
    .orderBy(asc(importItem.rowNumber));

  for (const item of pending) {
    let result: RowResult;
    try {
      result = await createRow(deps, {
        workspaceId: job.workspaceId,
        startedBy: run.startedBy,
        item,
      });
    } catch {
      result = { outcome: "failed", reasonCode: "internal" };
    }
    const extraErrors: CsvIssue[] = [];
    if ("propertyId" in result && item.calendarUrlCiphertext) {
      const saved = await saveFeed(deps, {
        workspaceId: job.workspaceId,
        propertyId: result.propertyId,
        timeZone: result.timeZone,
        startedBy: run.startedBy,
        item,
      });
      if (!saved) extraErrors.push({ column: "calendarUrl", code: "calendar_rejected" });
    }
    await finishItem(db, run.id, item, result, extraErrors);
  }

  const now = deps.now?.() ?? new Date();
  const [finished] = await db
    .update(importRun)
    .set({ status: "completed", finishedAt: now, notifiedAt: now })
    .where(eq(importRun.id, run.id))
    .returning();
  await recordEvent(db, {
    type: "import.finished",
    workspaceId: job.workspaceId,
    actorUserId: run.startedBy,
    targetType: "import_run",
    targetId: run.id,
    metadata: {
      kind: "csv",
      total: finished!.total,
      created: finished!.created,
      needsDetails: finished!.needsDetails,
      failed: finished!.failed,
      skipped: finished!.skipped,
    },
  });
  const reasons = await db
    .select({ reasonCode: importItem.reasonCode })
    .from(importItem)
    .where(
      and(eq(importItem.importRunId, run.id), sql`${importItem.outcome} IN ('failed', 'skipped')`),
    );
  await notifyManagers(
    db,
    deps.queueEmail,
    job.workspaceId,
    "properties.import_finished",
    (locale) =>
      renderImportFinished(locale, {
        source: "CSV",
        created: finished!.created,
        needsDetails: finished!.needsDetails,
        failed: finished!.failed,
        skipped: finished!.skipped,
        reasonCodes: [...new Set(reasons.map((item) => item.reasonCode ?? "invalid_row"))].slice(
          0,
          5,
        ),
        link: `${deps.portalUrl}/${locale}/properties/imports/${run.id}`,
      }),
  );
  return "completed";
}

/** The pg-boss handlers: one span per run (constitution VIII). */
function createCsvHandler(
  queue: string,
  run: (deps: CsvJobDeps, job: CsvJob) => Promise<string>,
  deps: CsvJobDeps,
) {
  return async (jobs: { id: string; data: unknown }[]): Promise<void> => {
    for (const job of jobs) {
      const data = job.data as Partial<CsvJob>;
      if (typeof data.importRunId !== "string" || typeof data.workspaceId !== "string") continue;
      const payload = { importRunId: data.importRunId, workspaceId: data.workspaceId };
      await runInJobSpan(
        { queue, workspaceId: payload.workspaceId },
        async (span) => {
          const outcome = await run(deps, payload);
          span.set({ "job.outcome": outcome });
          if (outcome === "failed") span.recordFailure("csv_unreadable");
        },
        deps.span,
      );
    }
  };
}

export function createCsvValidateHandler(deps: CsvJobDeps) {
  return createCsvHandler(JOB_QUEUES.csvValidate, runCsvValidate, deps);
}

export function createCsvImportHandler(deps: CsvJobDeps) {
  return createCsvHandler(JOB_QUEUES.csvImport, runCsvImport, deps);
}
