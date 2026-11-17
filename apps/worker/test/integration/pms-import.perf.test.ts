import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  createDb,
  importItem,
  importRun,
  membership,
  pmsConnection,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import {
  LocalKeyManagement,
  type PmsListing,
  type PmsPort,
  type PmsReservation,
  type PmsReservationQuery,
} from "@guidesk/integrations";
import { createDataKeyStore, Vault } from "@guidesk/vault";
import { VaultDecrypter } from "@guidesk/vault/decrypt";
import { runPmsImport } from "../../src/jobs/pms-import.js";

/**
 * A PMS import of 50 listings finishes within 10 minutes (SC-004, T124), subject to the
 * provider's rate limits. The provider is simulated on a clock: each request takes the
 * per-request latency below and spends Beds24 credits, and the import never goes below the
 * 30-credit floor, so it waits for the 5-minute window to reset when it would. The database work
 * is real and measured. The latency is an assumption until the fixtures are replaced with
 * recordings from test accounts (T129). All data is fictional.
 */
const LISTINGS = 50;
const BUDGET_MS = 10 * 60_000;
/** p95 latency of one provider request (assumed; T129 replaces it with recorded values). */
const REQUEST_LATENCY_MS = 2_000;
/** Beds24: credits per 5-minute window, the cost of one read, and the floor Guidesk keeps. */
const WINDOW_CREDITS = 100;
const WINDOW_MS = 5 * 60_000;
const REQUEST_CREDITS = 5;
const CREDIT_FLOOR = 30;
const PAGE_SIZE = 100;

const kms = new LocalKeyManagement(Buffer.alloc(32, 5));
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** A provider on a simulated clock, with Beds24's credit window. */
class SimulatedBeds24 implements PmsPort {
  readonly provider = "beds24" as const;
  elapsedMs = 0;
  requests = 0;
  waitedMs = 0;
  private credits: number;
  private windowEndsAt: number;

  constructor(startingCredits: number) {
    this.credits = startingCredits;
    this.windowEndsAt = WINDOW_MS / 2;
  }

  /** One request: wait for the window if it would break the floor, then spend and take time. */
  private async request(): Promise<void> {
    if (this.credits - REQUEST_CREDITS < CREDIT_FLOOR) {
      const wait = Math.max(0, this.windowEndsAt - this.elapsedMs);
      this.waitedMs += wait;
      this.elapsedMs += wait;
      this.credits = WINDOW_CREDITS;
      this.windowEndsAt = this.elapsedMs + WINDOW_MS;
    }
    this.credits -= REQUEST_CREDITS;
    this.requests += 1;
    this.elapsedMs += REQUEST_LATENCY_MS;
  }

  async validateCredential(): Promise<never> {
    throw new Error("not used");
  }

  async listListings(): Promise<PmsListing[]> {
    const listings = Array.from({ length: LISTINGS }, (_, i) => listing(i));
    for (let page = 0; page < Math.ceil(listings.length / PAGE_SIZE); page += 1) {
      await this.request();
    }
    return listings;
  }

  async getListing(): Promise<null> {
    return null;
  }

  async listReservations(_credential: string, query: PmsReservationQuery) {
    const reservations: PmsReservation[] = query.listingExternalIds.flatMap((id, i) =>
      Array.from({ length: 6 }, (_, n) => ({
        externalUid: `bk-${i}-${n}`,
        listingExternalId: id,
        status: "active" as const,
        checkInDate: day(5 + n * 10),
        checkoutDate: day(8 + n * 10),
        guestCount: 2,
        guestName: null,
        bookingReference: `bk-${i}-${n}`,
        channel: "Airbnb",
      })),
    );
    for (let page = 0; page < Math.ceil(reservations.length / PAGE_SIZE); page += 1) {
      await this.request();
    }
    return reservations;
  }

  async revoke() {
    return { providerRevoked: true };
  }
}

function listing(index: number): PmsListing {
  return {
    externalId: `${1000 + index}:1`,
    name: `Casa Ficticia ${index + 1}`,
    facts: {
      addressLine1: `Calle Ficticia ${index + 1}`,
      city: "Sámara",
      region: "Guanacaste",
      postalCode: "50205",
      country: "CR",
      checkInTime: "15:00",
      checkoutTime: "11:00",
      maxGuests: 4,
    },
    texts: [
      {
        kind: "description",
        language: "es",
        body: "Casa frente al mar, a dos cuadras de la playa.",
        sourceField: "beds24:texts.propertyDescription",
      },
      {
        kind: "house_rules",
        language: "es",
        body: "No fumar adentro.\nSilencio después de las 10 pm.",
        sourceField: "beds24:texts.houseRules",
      },
    ],
    amenities: ["wifi", "pool", "free_parking"],
  };
}

let handle: DbHandle;

beforeAll(() => {
  handle = createDb(inject("databaseUrl"), { max: 3 });
});

afterAll(async () => {
  await handle.pool.end();
});

async function seededRun() {
  const ownerId = `owner-${randomUUID()}`;
  const workspaceId = randomUUID();
  await handle.db.insert(user).values({
    id: ownerId,
    name: "Dueña",
    email: `${ownerId}@example.com`,
    preferredLanguage: "es",
  });
  await handle.db
    .insert(workspace)
    .values({ id: workspaceId, name: "Espacio", createdBy: ownerId, propertyLimit: 100 });
  await handle.db.insert(membership).values({ workspaceId, userId: ownerId, role: "owner" });
  const connectionId = randomUUID();
  const credential = await new Vault(kms).encrypt(
    createDataKeyStore(handle.db),
    { workspaceId, table: "pms_connection", column: "credential_ciphertext", rowId: connectionId },
    "fictional-refresh-token",
  );
  await handle.db.insert(pmsConnection).values({
    id: connectionId,
    workspaceId,
    provider: "beds24",
    externalAccountId: `acct-${connectionId.slice(0, 8)}`,
    accountLabel: "Beds24 0042",
    credentialCiphertext: credential.ciphertext,
    dataKeyId: credential.dataKeyId,
  });
  const [run] = await handle.db
    .insert(importRun)
    .values({
      workspaceId,
      kind: "pms",
      pmsConnectionId: connectionId,
      status: "running",
      total: LISTINGS,
      startedBy: ownerId,
    })
    .returning({ id: importRun.id });
  await handle.db.insert(importItem).values(
    Array.from({ length: LISTINGS }, (_, i) => ({
      workspaceId,
      importRunId: run!.id,
      externalId: `${1000 + i}:1`,
      label: `${1000 + i}:1`,
    })),
  );
  return { workspaceId, runId: run!.id };
}

describe("PMS import of 50 listings (SC-004)", () => {
  it("finishes within 10 minutes, even when it starts just above the credit floor", async () => {
    const { workspaceId, runId } = await seededRun();
    // 32 credits left: the first read would go below 30, so it waits for the window to reset.
    const provider = new SimulatedBeds24(32);
    const started = performance.now();
    const outcome = await runPmsImport(
      {
        db: handle.db,
        decrypter: new VaultDecrypter(kms),
        vault: new Vault(kms),
        adapters: { beds24: provider, hostex: provider as unknown as PmsPort },
        queueEmail: async () => undefined,
        portalUrl: "https://app.example.test",
      },
      { importRunId: runId, workspaceId },
    );
    const databaseMs = performance.now() - started;

    expect(outcome).toBe("completed");
    const [run] = await handle.db.select().from(importRun).where(eq(importRun.id, runId));
    expect(run).toMatchObject({
      status: "completed",
      processed: LISTINGS,
      created: LISTINGS,
      failed: 0,
    });
    expect(provider.waitedMs).toBeGreaterThan(0);
    const total = provider.elapsedMs + databaseMs;
    expect(
      total,
      `simulated provider ${provider.elapsedMs} ms + database ${Math.round(databaseMs)} ms`,
    ).toBeLessThanOrEqual(BUDGET_MS);
  }, 120_000);
});
