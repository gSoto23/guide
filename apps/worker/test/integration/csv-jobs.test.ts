import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import {
  calendarFeed,
  createDb,
  importItem,
  importRun,
  membership,
  property,
  securityEvent,
  stay,
  upload,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import {
  InProcessSandbox,
  LocalKeyManagement,
  type EmailMessage,
  type FeedReadResponse,
} from "@guidesk/integrations";
import { createFileProcessor, type ObjectSource } from "@guidesk/sandbox/in-process";
import { createDataKeyStore, Vault } from "@guidesk/vault";
import { VaultDecrypter } from "@guidesk/vault/decrypt";
import { runCsvImport, runCsvValidate, type CsvJobDeps } from "../../src/jobs/csv.js";

/**
 * The CSV jobs (T105; FR-037 to FR-042, SC-005): `csv.validate` reads the file through the
 * sandbox's real parser and validates every row; `csv.import` creates the chosen rows and then
 * reads their calendar links. Feed reads are faked. All data is fictional.
 */
const kms = new LocalKeyManagement(Buffer.alloc(32, 7));
const PEPPER = "test-pepper-".padEnd(48, "x");
const fingerprint = (url: string) => createHmac("sha256", PEPPER).update(url).digest("hex");
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const HEADER = [
  "Nombre",
  "Calle y número",
  "Unidad",
  "Ciudad",
  "Provincia o región",
  "Código postal",
  "País",
  "Zona horaria",
  "Hora de entrada",
  "Hora de salida",
  "Máximo de huéspedes",
  "Idiomas de la guía",
  "Enlace del calendario (iCal)",
];
const GOOD_LINK = "https://www.airbnb.com/calendar/ical/4821.ics?s=fictional-token";
const BLOCKED_LINK = "https://169.254.169.254/latest/meta-data.ics";

/** File row `fileRow` (the header is row 1): a complete property unless overridden. */
function row(fileRow: number, overrides: Partial<Record<number, string>> = {}): string[] {
  const cells = [
    `Casa Ficticia ${fileRow}`,
    `Calle Ficticia ${fileRow}`,
    "",
    "Sámara",
    "Guanacaste",
    "50205",
    "CR",
    "America/Costa_Rica",
    "15:00",
    "11:00",
    "4",
    "es, en",
    "",
  ];
  for (const [index, value] of Object.entries(overrides)) cells[Number(index)] = value!;
  return cells;
}

const quote = (cell: string) => (/[;"\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

/** A file as a spreadsheet in Spanish saves it: byte-order mark, semicolons, CRLF. */
function spanishFile(rows: string[][]): Buffer {
  const lines = [HEADER, ...rows].map((cells) => cells.map(quote).join(";"));
  return Buffer.from(`\ufeff${lines.join("\r\n")}\r\n`, "utf8");
}

class MemoryStorage implements ObjectSource {
  readonly objects = new Map<string, Buffer>();
  readonly deleted: string[] = [];
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

let handle: DbHandle;
let workspaceId: string;
let ownerId: string;
let storage: MemoryStorage;
let feedReads: string[];
let emails: EmailMessage[];

beforeAll(() => {
  handle = createDb(inject("databaseUrl"), { max: 3 });
});

afterAll(async () => {
  await handle.pool.end();
});

beforeEach(async () => {
  ownerId = `owner-${randomUUID()}`;
  workspaceId = randomUUID();
  await handle.db.insert(user).values({
    id: ownerId,
    name: "Dueña",
    email: `${ownerId}@example.com`,
    preferredLanguage: "es",
  });
  await handle.db
    .insert(workspace)
    .values({ id: workspaceId, name: "Espacio", createdBy: ownerId, propertyLimit: 30 });
  await handle.db.insert(membership).values({ workspaceId, userId: ownerId, role: "owner" });
  storage = new MemoryStorage();
  feedReads = [];
  emails = [];
});

function readFeed(request: { url: string }): Promise<FeedReadResponse> {
  feedReads.push(request.url);
  if (new URL(request.url).hostname === "169.254.169.254") {
    return Promise.resolve({ error: "blocked_address" });
  }
  return Promise.resolve({
    entries: [
      { uid: "res-1@fixture.test", start: day(3), end: day(6), kind: "reservation" },
      { uid: "res-2@fixture.test", start: day(9), end: day(11), kind: "unlabeled" },
    ],
    etag: '"v1"',
    lastModified: null,
  });
}

function deps(): CsvJobDeps {
  return {
    db: handle.db,
    sandbox: new InProcessSandbox({
      readFeed,
      processFile: createFileProcessor({
        storage,
        recognizer: { recognize: async () => "not used" },
      }),
    }),
    vault: new Vault(kms),
    decrypter: new VaultDecrypter(kms),
    fingerprint,
    queueEmail: async (message) => void emails.push(message),
    portalUrl: "https://app.example.test",
  };
}

/** A run whose file is uploaded, as `POST /imports/{id}/validate` leaves it. */
async function uploadedRun(file: Buffer): Promise<{ runId: string; objectKey: string }> {
  const runId = randomUUID();
  const uploadId = randomUUID();
  const objectKey = `uploads/${workspaceId}/${uploadId}`;
  storage.objects.set(objectKey, file);
  await handle.db
    .insert(importRun)
    .values({ id: runId, workspaceId, kind: "csv", status: "validating", startedBy: ownerId });
  await handle.db.insert(upload).values({
    id: uploadId,
    workspaceId,
    purpose: "csv",
    objectKey,
    declaredType: "text/csv",
    declaredSize: Math.max(file.length, 1),
    status: "received",
    createdBy: ownerId,
    importRunId: runId,
  });
  await handle.db.update(importRun).set({ uploadId }).where(eq(importRun.id, runId));
  return { runId, objectKey };
}

async function runOf(runId: string) {
  const [run] = await handle.db.select().from(importRun).where(eq(importRun.id, runId));
  return run!;
}

async function itemsOf(runId: string) {
  return handle.db
    .select()
    .from(importItem)
    .where(eq(importItem.importRunId, runId))
    .orderBy(importItem.rowNumber);
}

/** What `POST /imports/{id}/confirm` does when every valid row fits. */
async function confirm(runId: string) {
  await handle.db
    .update(importRun)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(importRun.id, runId));
}

async function propertiesOf() {
  return handle.db
    .select()
    .from(property)
    .where(eq(property.workspaceId, workspaceId))
    .orderBy(property.name);
}

describe("csv.validate (FR-038, FR-039)", () => {
  it("validates every row before anything is created, and lists errors by row and column", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => {
      const fileRow = i + 2;
      if (fileRow === 7) return row(fileRow, { 7: "Mars/Olympus" });
      if (fileRow === 19)
        return row(fileRow, { 0: '=HYPERLINK("https://evil.example")', 10: "cuatro" });
      return row(fileRow);
    });
    const { runId, objectKey } = await uploadedRun(spanishFile(rows));

    expect(await runCsvValidate(deps(), { importRunId: runId, workspaceId })).toBe("validated");

    expect(await runOf(runId)).toMatchObject({
      status: "awaiting_confirmation",
      total: 25,
      processed: 2,
      failed: 2,
    });
    const items = await itemsOf(runId);
    expect(items).toHaveLength(25);
    expect(items.filter((item) => item.outcome === "pending" && item.selected)).toHaveLength(23);
    const invalid = items.filter((item) => item.outcome === "failed");
    expect(invalid.map((item) => [item.rowNumber, item.reasonCode, item.errors])).toEqual([
      [7, "invalid_row", [{ column: "timeZone", code: "invalid_time_zone" }]],
      [19, "invalid_row", [{ column: "maxGuests", code: "invalid_guests" }]],
    ]);
    // The typed values are kept for the error file, the formula included (it is neutralized
    // when the file is written).
    expect(invalid[1]!.rowValues).toMatchObject({ name: '=HYPERLINK("https://evil.example")' });
    expect(items[0]).toMatchObject({ label: "Casa Ficticia 2", rowNumber: 2 });
    // Nothing is created before the host confirms (US5 scenario 2).
    expect(await propertiesOf()).toEqual([]);
    // The file is deleted once read (data model §6).
    expect(storage.deleted).toEqual([objectKey]);
    const [file] = await handle.db.select().from(upload).where(eq(upload.objectKey, objectKey));
    expect(file).toMatchObject({ status: "deleted", rejectReason: null });
    expect(file!.deletedAt).toBeInstanceOf(Date);
  });

  it("keeps a calendar link only as ciphertext, and an invalid one as a column error", async () => {
    const { runId } = await uploadedRun(
      spanishFile([
        row(2, { 12: GOOD_LINK }),
        row(3, { 12: "http://calendar.example.test/feed.ics" }),
        row(4, { 6: "Narnia", 12: GOOD_LINK }),
      ]),
    );
    await runCsvValidate(deps(), { importRunId: runId, workspaceId });
    const [withLink, badLink, invalidRow] = await itemsOf(runId);

    expect(withLink!.calendarUrlCiphertext).toBeInstanceOf(Buffer);
    expect(withLink!.calendarUrlCiphertext!.toString("latin1")).not.toContain("airbnb");
    expect(JSON.stringify(withLink!.rowValues)).not.toContain("airbnb");
    const decrypted = await new VaultDecrypter(kms).decryptText(
      createDataKeyStore(handle.db),
      {
        workspaceId,
        table: "import_item",
        column: "calendar_url_ciphertext",
        rowId: withLink!.id,
        dataKeyId: withLink!.dataKeyId!,
      },
      withLink!.calendarUrlCiphertext!,
    );
    expect(decrypted).toBe(GOOD_LINK);

    // An invalid link is an error for its column only; the row can still be created (FR-042).
    expect(badLink).toMatchObject({
      outcome: "pending",
      selected: true,
      errors: [{ column: "calendarUrl", code: "invalid_calendar_link" }],
      calendarUrlCiphertext: null,
    });
    expect(JSON.stringify(badLink!.rowValues)).not.toContain("calendar.example.test");
    // A row that cannot be created keeps no link.
    expect(invalidRow).toMatchObject({ outcome: "failed", calendarUrlCiphertext: null });
  });

  it("flags duplicate rows and rows matching an existing property (FR-040)", async () => {
    await handle.db.insert(property).values({
      workspaceId,
      name: "Torre Mar 4B",
      guideLanguages: ["es", "en"],
      setupStatus: "needs_details",
      missingFacts: ["addressLine1"],
      source: "manual",
    });
    const { runId } = await uploadedRun(
      spanishFile([
        row(2),
        row(3, { 0: "Otra casa", 1: "Calle Ficticia 2" }),
        row(4, { 0: "Torre Mar 4B" }),
      ]),
    );
    await runCsvValidate(deps(), { importRunId: runId, workspaceId });
    const items = await itemsOf(runId);
    expect(items.map((item) => item.warnings)).toEqual([
      [],
      [{ column: "addressLine1", code: "duplicate_row", row: 2 }],
      [{ column: "name", code: "existing_property" }],
    ]);
    expect(items.every((item) => item.outcome === "pending")).toBe(true);
  });

  it("fails the run with a reason when the file cannot be used", async () => {
    const cases: [Buffer, string][] = [
      [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]), "unsupported_type"],
      [Buffer.from("Ciudad;País\r\nSámara;CR\r\n"), "missing_name_column"],
      [spanishFile([]), "no_rows"],
      [Buffer.from(`Nombre\n${"Casa\n".repeat(501)}`), "too_many_rows"],
    ];
    for (const [file, reason] of cases) {
      const { runId } = await uploadedRun(file);
      expect(await runCsvValidate(deps(), { importRunId: runId, workspaceId })).toBe("failed");
      const run = await runOf(runId);
      expect(run.status).toBe("failed");
      expect(run.finishedAt).toBeInstanceOf(Date);
      const [file_] = await handle.db.select().from(upload).where(eq(upload.importRunId, runId));
      expect(file_).toMatchObject({ status: "deleted", rejectReason: reason });
      expect(await itemsOf(runId)).toEqual([]);
    }
  });

  it("skips a run that is not waiting for validation", async () => {
    const { runId } = await uploadedRun(spanishFile([row(2)]));
    await handle.db.update(importRun).set({ status: "cancelled" }).where(eq(importRun.id, runId));
    expect(await runCsvValidate(deps(), { importRunId: runId, workspaceId })).toBe("skipped");
    expect(storage.deleted).toEqual([]);
  });

  it("validates 200 rows, each with a calendar link, within 10 seconds (SC-005)", async () => {
    const rows = Array.from({ length: 200 }, (_, i) => row(i + 2, { 12: `${GOOD_LINK}&n=${i}` }));
    const { runId } = await uploadedRun(spanishFile(rows));
    const started = performance.now();
    await runCsvValidate(deps(), { importRunId: runId, workspaceId });
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(await runOf(runId)).toMatchObject({ status: "awaiting_confirmation", total: 200 });
  });
});

describe("csv.validate at the row limit (R10, T124)", () => {
  it("validates 500 rows, each with a calendar link, within 30 seconds", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => row(i + 2, { 12: `${GOOD_LINK}&n=${i}` }));
    const { runId } = await uploadedRun(spanishFile(rows));
    const started = performance.now();
    await runCsvValidate(deps(), { importRunId: runId, workspaceId });
    expect(performance.now() - started).toBeLessThan(30_000);
    expect(await runOf(runId)).toMatchObject({ status: "awaiting_confirmation", total: 500 });
  }, 60_000);
});

describe("csv.import (FR-040, FR-042)", () => {
  it("creates the chosen rows as to_confirm or needs_details, then reports", async () => {
    const { runId } = await uploadedRun(
      spanishFile([row(2), row(3, { 3: "", 8: "" }), row(4, { 7: "" }), row(5, { 6: "Narnia" })]),
    );
    await runCsvValidate(deps(), { importRunId: runId, workspaceId });
    await confirm(runId);

    expect(await runCsvImport(deps(), { importRunId: runId, workspaceId })).toBe("completed");

    const created = await propertiesOf();
    expect(created.map((p) => [p.name, p.setupStatus, p.source, p.missingFacts])).toEqual([
      ["Casa Ficticia 2", "to_confirm", "csv", []],
      ["Casa Ficticia 3", "needs_details", "csv", ["city", "checkInTime"]],
      // A blank zone is suggested from the country (FR-002).
      ["Casa Ficticia 4", "to_confirm", "csv", []],
    ]);
    expect(created[2]!.timeZone).toBe("America/Costa_Rica");
    expect(created[0]).toMatchObject({
      addressLine1: "Calle Ficticia 2",
      country: "CR",
      checkInTime: "15:00:00",
      maxGuests: 4,
      guideLanguages: ["es", "en"],
      createdBy: ownerId,
    });

    expect(await runOf(runId)).toMatchObject({
      status: "completed",
      total: 4,
      processed: 4,
      created: 2,
      needsDetails: 1,
      failed: 1,
    });
    const items = await itemsOf(runId);
    expect(items.map((item) => [item.rowNumber, item.outcome])).toEqual([
      [2, "created"],
      [3, "needs_details"],
      [4, "created"],
      [5, "failed"],
    ]);
    expect(items.slice(0, 3).every((item) => item.propertyId)).toBe(true);

    const events = await handle.db
      .select()
      .from(securityEvent)
      .where(
        and(eq(securityEvent.workspaceId, workspaceId), eq(securityEvent.type, "import.finished")),
      );
    expect(events).toHaveLength(1);
    expect(events[0]!.metadata).toMatchObject({
      kind: "csv",
      created: 2,
      needsDetails: 1,
      failed: 1,
    });
    expect(emails).toHaveLength(1);
    expect(emails[0]!.template).toBe("properties.import_finished");
    expect(`${emails[0]!.subject} ${emails[0]!.text}`).toContain("CSV");
  });

  it("reads each calendar link after the property exists, and reports a rejected one on its row", async () => {
    const { runId } = await uploadedRun(
      spanishFile([row(2, { 12: GOOD_LINK }), row(3, { 12: BLOCKED_LINK }), row(4)]),
    );
    await runCsvValidate(deps(), { importRunId: runId, workspaceId });
    // Nothing is read at validation (FR-042).
    expect(feedReads).toEqual([]);
    await confirm(runId);
    await runCsvImport(deps(), { importRunId: runId, workspaceId });

    expect(feedReads).toEqual([GOOD_LINK, BLOCKED_LINK]);
    const [withFeed, rejected] = await itemsOf(runId);
    const feeds = await handle.db
      .select()
      .from(calendarFeed)
      .where(eq(calendarFeed.workspaceId, workspaceId));
    expect(feeds).toHaveLength(1);
    expect(feeds[0]).toMatchObject({
      propertyId: withFeed!.propertyId,
      channel: "airbnb",
      urlFingerprint: fingerprint(new URL(GOOD_LINK).toString()),
      status: "active",
      createdBy: ownerId,
    });
    expect(feeds[0]!.urlCiphertext.toString("latin1")).not.toContain("airbnb");
    expect(feeds[0]!.displayHint).not.toContain("fictional-token");
    const stays = await handle.db
      .select()
      .from(stay)
      .where(eq(stay.propertyId, withFeed!.propertyId!));
    expect(stays).toHaveLength(2);

    // The rejected link becomes a column error on a created row; the property keeps no feed.
    expect(rejected).toMatchObject({
      outcome: "created",
      errors: [{ column: "calendarUrl", code: "calendar_rejected" }],
    });
    // After the import, no row holds a calendar link.
    const held = await handle.db
      .select({ id: importItem.id })
      .from(importItem)
      .where(eq(importItem.importRunId, runId));
    const withCiphertext = (await itemsOf(runId)).filter(
      (item) => item.calendarUrlCiphertext !== null || item.dataKeyId !== null,
    );
    expect(held).toHaveLength(3);
    expect(withCiphertext).toEqual([]);
    expect(JSON.stringify(await itemsOf(runId))).not.toContain("airbnb.com");
  });

  it("stops at the plan limit, even when a property was added after confirming", async () => {
    await handle.db
      .update(workspace)
      .set({ propertyLimit: 2 })
      .where(eq(workspace.id, workspaceId));
    const { runId } = await uploadedRun(spanishFile([row(2), row(3)]));
    await runCsvValidate(deps(), { importRunId: runId, workspaceId });
    await confirm(runId);
    await handle.db.insert(property).values({
      workspaceId,
      name: "Agregada a mano",
      guideLanguages: ["es"],
      setupStatus: "needs_details",
      missingFacts: ["addressLine1"],
      source: "manual",
    });

    await runCsvImport(deps(), { importRunId: runId, workspaceId });
    const items = await itemsOf(runId);
    expect(items.map((item) => [item.outcome, item.reasonCode])).toEqual([
      ["created", null],
      ["skipped", "plan_limit"],
    ]);
    expect(await runOf(runId)).toMatchObject({ created: 1, skipped: 1, processed: 2 });
  });

  it("creates only the rows still pending and selected", async () => {
    const { runId } = await uploadedRun(spanishFile([row(2), row(3)]));
    await runCsvValidate(deps(), { importRunId: runId, workspaceId });
    const [, second] = await itemsOf(runId);
    await handle.db
      .update(importItem)
      .set({ selected: false, outcome: "skipped", reasonCode: "not_selected" })
      .where(inArray(importItem.id, [second!.id]));
    await confirm(runId);
    await runCsvImport(deps(), { importRunId: runId, workspaceId });
    expect((await propertiesOf()).map((p) => p.name)).toEqual(["Casa Ficticia 2"]);
  });

  it("skips a run that is not running", async () => {
    const { runId } = await uploadedRun(spanishFile([row(2)]));
    await runCsvValidate(deps(), { importRunId: runId, workspaceId });
    expect(await runCsvImport(deps(), { importRunId: runId, workspaceId })).toBe("skipped");
    expect(await propertiesOf()).toEqual([]);
  });
});
