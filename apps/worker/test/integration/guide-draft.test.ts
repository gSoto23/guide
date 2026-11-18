import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  createDb,
  createGuideForProperty,
  guide,
  guideAiRequest,
  listingContent,
  membership,
  property,
  user,
  workspace,
  type DbHandle,
} from "@guidesk/db";
import { FakeLlmAdapter } from "@guidesk/integrations";
import { runGuideDraft } from "../../src/jobs/guide-draft.js";

/**
 * The guide draft job (feature 003 T040, research R16, FR-004, FR-005, FR-025, FR-026): house
 * rules and amenities placed without the AI, the description split by the model after the
 * detector, every item unreviewed and labeled, and the daily limit honored. Fictional text only.
 */
let handle: DbHandle;
let workspaceId: string;
let propertyId: string;
let guideId: string;

beforeAll(async () => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
});

afterAll(async () => {
  await handle.pool.end();
});

async function seedProperty(
  source: "listing_text" | "pms" = "listing_text",
  provider: "beds24" | null = null,
) {
  const ownerId = `owner-${randomUUID()}`;
  workspaceId = randomUUID();
  await handle.db
    .insert(user)
    .values({ id: ownerId, name: "Dueña", email: `${ownerId}@example.com` });
  await handle.db
    .insert(workspace)
    .values({ id: workspaceId, name: "Espacio", createdBy: ownerId });
  await handle.db.insert(membership).values({ workspaceId, userId: ownerId, role: "owner" });
  const [row] = await handle.db
    .insert(property)
    .values({
      workspaceId,
      name: "Casa Colibrí",
      guideLanguages: ["es", "en"],
      setupStatus: "ready",
      source: source === "pms" ? "pms" : "listing_text",
      sourceProvider: provider,
    })
    .returning({ id: property.id });
  propertyId = row!.id;
  guideId = (
    await createGuideForProperty(handle.db, {
      workspaceId,
      propertyId,
      guideLanguages: ["es", "en"],
    })
  ).guideId;
  await handle.db.insert(listingContent).values([
    {
      workspaceId,
      propertyId,
      kind: "house_rules",
      body: "No se permiten fiestas.\nSilencio después de las 22:00.",
      source,
      language: "es",
    },
    {
      workspaceId,
      propertyId,
      kind: "amenities",
      items: ["Wi-Fi", "Piscina"],
      source,
      language: "es",
    },
    {
      workspaceId,
      propertyId,
      kind: "description",
      body: "Casa luminosa frente al mar.\nParqueo para un carro frente a la casa.\nEl código de la puerta es 4821.\nSupermercado a 300 metros.",
      source,
      language: "es",
    },
  ]);
}

async function items() {
  const result = await handle.db.execute<{
    section: string;
    source: string;
    source_detail: string | null;
    reviewed: boolean;
    topics: string[];
    text: string;
  }>(sql`
    SELECT s.kind AS section, i.source, i.source_detail, i.reviewed_at IS NOT NULL AS reviewed, i.topics,
           t.doc::text AS text
    FROM guide_item i
    JOIN guide_section s ON s.id = i.section_id
    LEFT JOIN guide_item_text t ON t.item_id = i.id
    WHERE s.guide_id = ${guideId} AND i.kind <> 'fact'
    ORDER BY s.position, i.position`);
  return result.rows;
}

describe("guide.draft", () => {
  beforeEach(async () => {
    await seedProperty();
  });

  it("places house rules and amenities, and splits the description across sections", async () => {
    const llm = new FakeLlmAdapter();
    expect(await runGuideDraft({ db: handle.db, llm }, { guideId, workspaceId })).toBe("drafted");
    const rows = await items();
    expect(rows.map((row) => row.section)).toEqual(
      expect.arrayContaining(["house_rules", "amenities", "parking", "local_recommendations"]),
    );
    expect(rows.every((row) => row.source === "listing" && !row.reviewed)).toBe(true);
    expect(rows.find((row) => row.section === "parking")?.topics).toEqual(["parking.where"]);
    const [state] = await handle.db
      .select({ draftState: guide.draftState })
      .from(guide)
      .where(eq(guide.id, guideId));
    expect(state?.draftState).toBe("ready");
  });

  it("never sends a code to the model, nor stores one from its output (FR-025)", async () => {
    const llm = new FakeLlmAdapter();
    await runGuideDraft({ db: handle.db, llm }, { guideId, workspaceId });
    expect(llm.calls.join("\n")).not.toContain("4821");
    expect((await items()).map((row) => row.text).join("\n")).not.toContain("4821");
  });

  it("is idempotent for the placed content", async () => {
    const llm = new FakeLlmAdapter();
    await runGuideDraft({ db: handle.db, llm }, { guideId, workspaceId });
    const count = (await items()).filter((row) => row.section === "house_rules").length;
    await handle.db.update(guide).set({ draftState: "pending" }).where(eq(guide.id, guideId));
    await runGuideDraft(
      { db: handle.db, llm: new FakeLlmAdapter({ guideOutcome: "refused" }) },
      { guideId, workspaceId },
    );
    expect((await items()).filter((row) => row.section === "house_rules")).toHaveLength(count);
  });

  it("waits at the daily AI limit without calling the model", async () => {
    await handle.db
      .update(workspace)
      .set({ guideAiDailyLimit: 1 })
      .where(eq(workspace.id, workspaceId));
    await handle.db.execute(
      sql`INSERT INTO rate_limit_bucket (key, window_start, count)
          VALUES (${`guide-ai:${workspaceId}:${new Date().toISOString().slice(0, 10)}`}, date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 1)`,
    );
    const llm = new FakeLlmAdapter();
    expect(await runGuideDraft({ db: handle.db, llm }, { guideId, workspaceId })).toBe(
      "waiting_limit",
    );
    expect(llm.guideCalls).toHaveLength(0);
    expect((await items()).some((row) => row.section === "house_rules")).toBe(true);
  });

  it("keeps the placed content and marks the draft failed on a refusal or an outage", async () => {
    expect(
      await runGuideDraft(
        { db: handle.db, llm: new FakeLlmAdapter({ guideOutcome: "refused" }) },
        { guideId, workspaceId },
      ),
    ).toBe("failed");
    expect((await items()).some((row) => row.section === "amenities")).toBe(true);
    const usage = await handle.db
      .select({ kind: guideAiRequest.kind, outcome: guideAiRequest.outcome })
      .from(guideAiRequest)
      .where(eq(guideAiRequest.guideId, guideId));
    expect(usage).toEqual([{ kind: "draft_listing", outcome: "refused" }]);
    await handle.db.update(guide).set({ draftState: "pending" }).where(eq(guide.id, guideId));
    expect(
      await runGuideDraft(
        { db: handle.db, llm: new FakeLlmAdapter({ unavailable: true }) },
        { guideId, workspaceId },
      ),
    ).toBe("ai_unavailable");
  });

  it("redrafts one section into new unreviewed items (FR-007)", async () => {
    const llm = new FakeLlmAdapter();
    await runGuideDraft({ db: handle.db, llm }, { guideId, workspaceId });
    const [parking] = (
      await handle.db.execute<{ id: string }>(
        sql`SELECT id FROM guide_section WHERE guide_id = ${guideId} AND kind = 'parking'`,
      )
    ).rows;
    const before = (await items()).length;
    await runGuideDraft({ db: handle.db, llm }, { guideId, workspaceId, sectionId: parking!.id });
    const after = await items();
    expect(after.length).toBe(before + 1);
    expect(after.filter((row) => row.section === "parking")).toHaveLength(2);
  });

  it("labels PMS content with the provider's name", async () => {
    await seedProperty("pms", "beds24");
    await runGuideDraft({ db: handle.db, llm: new FakeLlmAdapter() }, { guideId, workspaceId });
    const rows = await items();
    expect(rows.every((row) => row.source === "pms" && row.source_detail === "Beds24")).toBe(true);
  });

  it("retries while the guide is not visible yet", async () => {
    await expect(
      runGuideDraft(
        { db: handle.db, llm: new FakeLlmAdapter() },
        { guideId: randomUUID(), workspaceId },
      ),
    ).rejects.toThrow("not found yet");
  });
});
