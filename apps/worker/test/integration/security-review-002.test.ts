import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { Attributes, Span, SpanOptions, Tracer } from "@opentelemetry/api";
import { eq } from "drizzle-orm";
import {
  calendarFeed,
  createDb,
  extractionRequest,
  importItem,
  importRun,
  membership,
  pmsConnection,
  property,
  upload,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import {
  FakeLlmAdapter,
  InProcessSandbox,
  LocalKeyManagement,
  type EmailMessage,
  type FeedReadResponse,
  type LlmPort,
  type PmsListing,
  type PmsPort,
  type PmsReservation,
} from "@guidesk/integrations";
import { createFileProcessor, type ObjectSource } from "@guidesk/sandbox/in-process";
import { createDataKeyStore, Vault } from "@guidesk/vault";
import { VaultDecrypter } from "@guidesk/vault/decrypt";
import { createCalendarRefreshHandler } from "../../src/jobs/calendar-refresh.js";
import { createCsvImportHandler, createCsvValidateHandler } from "../../src/jobs/csv.js";
import { createExtractionHandler } from "../../src/jobs/extraction.js";
import { createPmsImportHandler } from "../../src/jobs/pms-import.js";

/**
 * The feature 002 security sweep on the worker (T122, quickstart 12, SC-003, AC-SEC-008,
 * AC-SEC-012): the feed refresh, CSV validation and import, extraction, and PMS import run with
 * known secrets, and none appears in spans, logs, emails, or the model's input. The API's side
 * is swept in apps/api/test/integration/security-review-002.test.ts. All data is fictional.
 */
const FEED_TOKEN = "s3cr3t-feed-7f3a9c1b2d";
const FEED_LINK = `https://calendar.example.test/ical/${FEED_TOKEN}.ics`;
const CSV_FEED_TOKEN = "s3cr3t-csv-feed-6d02";
const CSV_LINK = `https://www.airbnb.com/calendar/ical/1.ics?s=${CSV_FEED_TOKEN}`;
const PMS_TOKEN = "s3cr3t-pms-refresh-8c1e";
const DOOR_CODE = "Door code 58431";
const WIFI = "WiFi password: sunshine99";
const GUEST_NAME = "Rosaura Prueba Secreta";
const SECRETS = [
  FEED_TOKEN,
  CSV_FEED_TOKEN,
  PMS_TOKEN,
  "58431",
  "sunshine99",
  GUEST_NAME,
  "calendar.example.test/ical",
];

// --- a tracer that records everything a span is given ---

interface RecordedSpan {
  name: string;
  attributes: Attributes;
  events: unknown[];
  status: unknown[];
}

const spans: RecordedSpan[] = [];

function recordingSpan(name: string, options?: SpanOptions): Span {
  const recorded: RecordedSpan = {
    name,
    attributes: { ...options?.attributes },
    events: [],
    status: [],
  };
  spans.push(recorded);
  const span: Span = {
    spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 1 }),
    setAttribute: (key, value) => ((recorded.attributes[key] = value), span),
    setAttributes: (attributes) => (Object.assign(recorded.attributes, attributes), span),
    addEvent: (...args: unknown[]) => (recorded.events.push(args), span),
    addLink: () => span,
    addLinks: () => span,
    setStatus: (status) => (recorded.status.push(status), span),
    updateName: (next) => ((recorded.name = next), span),
    end: () => undefined,
    isRecording: () => true,
    recordException: (exception) => void recorded.events.push(["exception", String(exception)]),
  };
  return span;
}

const tracer: Tracer = {
  startSpan: (name, options) => recordingSpan(name, options),
  startActiveSpan: ((name: string, ...rest: unknown[]) => {
    const fn = rest.at(-1) as (span: Span) => unknown;
    const options = (rest.length > 1 ? rest[0] : undefined) as SpanOptions | undefined;
    return fn(recordingSpan(name, options));
  }) as Tracer["startActiveSpan"],
};
const span = { tracer, failures: { add: () => undefined } };

// --- logs ---

/* eslint-disable no-console -- the capture wraps console methods to inspect what they print */

const logged: string[] = [];
const originals = {
  stdout: process.stdout.write.bind(process.stdout),
  stderr: process.stderr.write.bind(process.stderr),
  console: (["log", "info", "warn", "error", "debug"] as const).map((name) => [
    name,
    console[name],
  ]),
};

function startCapture() {
  const record =
    (original: typeof process.stdout.write) =>
    (chunk: unknown, ...rest: unknown[]): boolean => {
      logged.push(typeof chunk === "string" ? chunk : Buffer.from(chunk as Uint8Array).toString());
      return (original as (...args: unknown[]) => boolean)(chunk, ...rest);
    };
  process.stdout.write = record(originals.stdout) as typeof process.stdout.write;
  process.stderr.write = record(originals.stderr) as typeof process.stderr.write;
  for (const [name] of originals.console) {
    console[name as "log"] = (...args: unknown[]) =>
      void logged.push(
        args.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
  }
}

function stopCapture() {
  process.stdout.write = originals.stdout as typeof process.stdout.write;
  process.stderr.write = originals.stderr as typeof process.stderr.write;
  for (const [name, method] of originals.console) {
    console[name as "log"] = method as (typeof console)["log"];
  }
}

/* eslint-enable no-console */

// --- the flows ---

const kms = new LocalKeyManagement(Buffer.alloc(32, 7));
const vault = new Vault(kms);
const decrypter = new VaultDecrypter(kms);
const emails: EmailMessage[] = [];
const modelInputs: string[] = [];
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let handle: DbHandle;
let workspaceId: string;
let ownerId: string;

class MemoryStorage implements ObjectSource {
  readonly objects = new Map<string, Buffer>();
  async get(key: string) {
    return this.objects.get(key) ?? null;
  }
  async delete(key: string) {
    this.objects.delete(key);
  }
}

const storage = new MemoryStorage();

function readFeed(): Promise<FeedReadResponse> {
  return Promise.resolve({
    entries: [{ uid: "res-1@fixture.test", start: day(3), end: day(6), kind: "reservation" }],
    etag: null,
    lastModified: null,
  });
}

const sandbox = new InProcessSandbox({
  tracer,
  readFeed,
  processFile: createFileProcessor({
    storage,
    // A screenshot's text, with a code the job must remove before the model sees it.
    recognizer: { recognize: async () => `Casa frente al mar.\n${DOOR_CODE}\n${WIFI}` },
  }),
});

const fakeModel = new FakeLlmAdapter();
const llm: LlmPort = {
  extractListing: async (text, options) => {
    modelInputs.push(text);
    return fakeModel.extractListing(text, options);
  },
};

class FakePms implements PmsPort {
  readonly provider = "beds24" as const;
  async validateCredential(): Promise<never> {
    throw new Error("not used");
  }
  async listListings(): Promise<PmsListing[]> {
    return [
      {
        externalId: "101",
        name: "Casa Colibrí",
        facts: {
          addressLine1: "Calle Ficticia 123",
          city: "Sámara",
          region: null,
          postalCode: null,
          country: "CR",
          checkInTime: "15:00",
          checkoutTime: "11:00",
          maxGuests: 4,
        },
        texts: [
          {
            kind: "house_rules",
            language: "es",
            body: `No fumar.\n${DOOR_CODE}\n${WIFI}`,
            sourceField: "beds24:texts.houseRules",
          },
        ],
        amenities: ["wifi"],
      },
    ];
  }
  async getListing(): Promise<null> {
    return null;
  }
  async listReservations(): Promise<PmsReservation[]> {
    return [
      {
        externalUid: "bk-1",
        listingExternalId: "101",
        status: "active",
        checkInDate: day(5),
        checkoutDate: day(8),
        guestCount: 2,
        guestName: GUEST_NAME,
        bookingReference: "bk-1",
        channel: "Airbnb",
      },
    ];
  }
  async revoke() {
    return { providerRevoked: true };
  }
}

const job = (data: object) => [{ id: randomUUID(), data }];

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 3 });
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
    .values({ id: workspaceId, name: "Espacio", createdBy: ownerId, propertyLimit: 20 });
  await handle.db.insert(membership).values({ workspaceId, userId: ownerId, role: "owner" });
  const keys = createDataKeyStore(handle.db);

  // A feed, encrypted like the API stores it.
  const [prop] = await handle.db
    .insert(property)
    .values({
      workspaceId,
      name: "Casa Garza",
      timeZone: "America/Costa_Rica",
      guideLanguages: ["es"],
      setupStatus: "ready",
      source: "manual",
    })
    .returning({ id: property.id });
  const feedId = randomUUID();
  const link = await vault.encrypt(
    keys,
    { workspaceId, table: "calendar_feed", column: "url_ciphertext", rowId: feedId },
    FEED_LINK,
  );
  await handle.db.insert(calendarFeed).values({
    id: feedId,
    workspaceId,
    propertyId: prop!.id,
    channel: "airbnb",
    urlCiphertext: link.ciphertext,
    urlFingerprint: randomUUID(),
    displayHint: "calendar.example.test/…/2d.ics",
    dataKeyId: link.dataKeyId,
  });

  // A CSV file with a calendar link.
  const runId = randomUUID();
  const uploadId = randomUUID();
  const objectKey = `uploads/${workspaceId}/${uploadId}`;
  storage.objects.set(
    objectKey,
    Buffer.from(
      `Nombre;País;Ciudad;Calle y número;Enlace del calendario (iCal)\r\nCasa CSV;CR;Sámara;Calle Ficticia 9;${CSV_LINK}\r\n`,
    ),
  );
  await handle.db
    .insert(importRun)
    .values({ id: runId, workspaceId, kind: "csv", status: "validating", startedBy: ownerId });
  await handle.db.insert(upload).values({
    id: uploadId,
    workspaceId,
    purpose: "csv",
    objectKey,
    declaredType: "text/csv",
    declaredSize: 200,
    status: "received",
    createdBy: ownerId,
    importRunId: runId,
  });
  await handle.db.update(importRun).set({ uploadId }).where(eq(importRun.id, runId));

  // An extraction with a screenshot whose text holds codes.
  const [extraction] = await handle.db
    .insert(extractionRequest)
    .values({ workspaceId, status: "queued", requestedBy: ownerId, screenshotCount: 1 })
    .returning({ id: extractionRequest.id });
  const screenshotId = randomUUID();
  const screenshotKey = `uploads/${workspaceId}/${screenshotId}`;
  storage.objects.set(
    screenshotKey,
    readFileSync(
      new URL("../../../sandbox/test/fixtures/screenshots/en-cedar-cabin.png", import.meta.url),
    ),
  );
  await handle.db.insert(upload).values({
    id: screenshotId,
    workspaceId,
    purpose: "screenshot",
    objectKey: screenshotKey,
    declaredType: "image/png",
    declaredSize: 70,
    status: "received",
    createdBy: ownerId,
    extractionRequestId: extraction!.id,
  });

  // A PMS connection, with its token encrypted.
  const connectionId = randomUUID();
  const credential = await vault.encrypt(
    keys,
    { workspaceId, table: "pms_connection", column: "credential_ciphertext", rowId: connectionId },
    PMS_TOKEN,
  );
  await handle.db.insert(pmsConnection).values({
    id: connectionId,
    workspaceId,
    provider: "beds24",
    externalAccountId: "acct-sweep",
    accountLabel: "Beds24 0001",
    credentialCiphertext: credential.ciphertext,
    dataKeyId: credential.dataKeyId,
  });
  const [pmsRun] = await handle.db
    .insert(importRun)
    .values({
      workspaceId,
      kind: "pms",
      pmsConnectionId: connectionId,
      status: "running",
      total: 1,
      startedBy: ownerId,
    })
    .returning({ id: importRun.id });
  await handle.db
    .insert(importItem)
    .values({ workspaceId, importRunId: pmsRun!.id, externalId: "101", label: "101" });

  const queueEmail = async (message: EmailMessage) => void emails.push(message);
  const portalUrl = "https://app.example.test";
  const csvDeps = {
    db: handle.db,
    sandbox,
    vault,
    decrypter,
    fingerprint: (url: string) => `fp-${url.length}`,
    queueEmail,
    portalUrl,
    span,
  };

  startCapture();
  try {
    await createCalendarRefreshHandler({
      db: handle.db,
      decrypter,
      sandbox,
      queueEmail,
      portalUrl,
      span,
    })(job({ feedId, workspaceId }));
    await createCsvValidateHandler(csvDeps)(job({ importRunId: runId, workspaceId }));
    await handle.db.update(importRun).set({ status: "running" }).where(eq(importRun.id, runId));
    await createCsvImportHandler(csvDeps)(job({ importRunId: runId, workspaceId }));
    await createExtractionHandler({ db: handle.db, sandbox, llm, span })(
      job({ extractionId: extraction!.id, workspaceId }),
    );
    await createPmsImportHandler({
      db: handle.db,
      decrypter,
      vault,
      adapters: { beds24: new FakePms(), hostex: new FakePms() as unknown as PmsPort },
      queueEmail,
      portalUrl,
      span,
    })(job({ importRunId: pmsRun!.id, workspaceId }));
  } finally {
    stopCapture();
  }
});

afterAll(async () => {
  await handle.pool.end();
});

describe("feature 002 security sweep: the worker (T122, SC-003)", () => {
  it("ran every job and recorded their spans", async () => {
    const names = spans.map((recorded) => recorded.name);
    for (const queue of [
      "calendar.refresh",
      "csv.validate",
      "csv.import",
      "extraction.run",
      "pms.import",
    ]) {
      expect(names, queue).toContain(`job ${queue}`);
    }
    expect(names.some((name) => name.includes("feed-reader"))).toBe(true);
    expect(modelInputs).toHaveLength(1);
    expect(emails.map((message) => message.template)).toContain("properties.import_finished");
  });

  it("keeps every secret out of the spans", () => {
    const text = JSON.stringify(spans);
    for (const secret of SECRETS) {
      expect(text.includes(secret), `${secret} in a span`).toBe(false);
    }
  });

  it("keeps every secret out of the logs", () => {
    const text = logged.join("\n");
    for (const secret of SECRETS) {
      expect(text.includes(secret), `${secret} in the logs`).toBe(false);
    }
  });

  it("keeps every secret out of the emails", () => {
    for (const message of emails) {
      const text = `${message.subject}\n${message.text}\n${message.html}`;
      for (const secret of SECRETS) {
        expect(text.includes(secret), `${secret} in ${message.template}`).toBe(false);
      }
    }
  });

  it("sends the model the screenshot's text without its codes (AC-SEC-014)", () => {
    expect(modelInputs[0]).toContain("Casa frente al mar");
    expect(modelInputs[0]).not.toContain("58431");
    expect(modelInputs[0]).not.toContain("sunshine99");
  });
});
