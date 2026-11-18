import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  GuideView,
  PropertyDetail,
  PublishCheck,
  SectionWriteResult,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Translation states and actions (feature 003 T095, FR-044 to FR-048): a source edit makes
 * machine texts stale and reviewed ones out of date and schedules one debounced job; translate
 * again, keep as is, mark reviewed; editing a translation reviews it; adding a guide language
 * translates every section, and removing one leaves published versions alone. Fictional text.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let propertyId: string;
let itemId: string;
let sectionId: string;

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "translations");
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Bilingüe",
  });
  propertyId = (created.json() as PropertyDetail).id;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const path = (suffix = "") => `/properties/${propertyId}/guide${suffix}`;

async function guideAs(): Promise<GuideView> {
  return (await wsApi(ctx, team.owner, "GET", team.workspaceId, path())).json() as GuideView;
}

async function revision(): Promise<number> {
  return (await guideAs()).sections.find((section) => section.id === sectionId)!.revision;
}

async function english() {
  const { rows } = await db.query<{ state: string; origin: string; doc: unknown }>(
    `SELECT state, origin, doc FROM guide_item_text WHERE item_id = $1 AND language = 'en'`,
    [itemId],
  );
  return rows[0];
}

async function queued(language = "en"): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM pgboss.job
      WHERE name = 'guide.translate' AND state = 'created'
        AND data->>'sectionId' = $1 AND data->>'language' = $2`,
    [sectionId, language],
  );
  return rows[0]?.count ?? 0;
}

async function saveSource(text: string) {
  const response = await wsApi(
    ctx,
    team.owner,
    "PATCH",
    team.workspaceId,
    path(`/items/${itemId}`),
    {
      revision: await revision(),
      language: "es",
      doc: doc(text),
    },
  );
  expect(response.statusCode, response.body).toBe(200);
}

async function act(action: string, language = "en") {
  return wsApi(
    ctx,
    team.owner,
    "POST",
    team.workspaceId,
    path(`/items/${itemId}/translations/${language}`),
    { revision: await revision(), action },
  );
}

/** What the translation job would store. */
async function machineTranslate(text: string) {
  await db.query(
    `UPDATE guide_item_text SET doc = $2, origin = 'machine', state = 'current' WHERE item_id = $1 AND language = 'en'`,
    [itemId, JSON.stringify(doc(text))],
  );
}

describe("translations (US5)", () => {
  it("waits for a translation when a text is added, with one debounced job (FR-044)", async () => {
    const view = await guideAs();
    const appliances = view.sections.find((section) => section.kind === "appliances")!;
    sectionId = appliances.id;
    const created = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/sections/${sectionId}/items`),
      {
        revision: appliances.revision,
        kind: "text",
        language: "es",
        doc: doc("La cafetera está arriba."),
      },
    );
    expect(created.statusCode, created.body).toBe(201);
    itemId = (created.json() as SectionWriteResult).item!.id;
    expect(await english()).toMatchObject({ state: "stale", origin: "machine", doc: null });
    expect(await queued()).toBe(1);
    await saveSource("La cafetera está en el mueble de arriba.");
    expect(await queued()).toBe(1);
  });

  it("makes machine texts stale and reviewed ones out of date on a source edit (FR-046)", async () => {
    await machineTranslate("The coffee maker is upstairs.");
    await saveSource("La cafetera está en la alacena.");
    expect(await english()).toMatchObject({ state: "stale", origin: "machine" });

    // Editing the translation reviews it (FR-045).
    const edited = await wsApi(
      ctx,
      team.owner,
      "PATCH",
      team.workspaceId,
      path(`/items/${itemId}`),
      {
        revision: await revision(),
        language: "en",
        doc: doc("The coffee maker is in the pantry."),
      },
    );
    expect(edited.statusCode, edited.body).toBe(200);
    expect(await english()).toMatchObject({ state: "current", origin: "reviewed" });

    await saveSource("La cafetera está en la alacena de la cocina.");
    expect(await english()).toMatchObject({ state: "out_of_date", origin: "reviewed" });
    const check = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, path("/publish-check"))
    ).json() as PublishCheck;
    expect(check.warnings).toContainEqual({ kind: "out_of_date_translations", count: 1 });
  });

  it("keeps an out-of-date translation as is, or translates it again", async () => {
    const kept = await act("keep");
    expect(kept.statusCode, kept.body).toBe(200);
    expect(await english()).toMatchObject({ state: "current", origin: "reviewed" });
    expect(JSON.stringify((await english())?.doc)).toContain("pantry");

    await db.query(`DELETE FROM pgboss.job WHERE name = 'guide.translate'`);
    const again = await act("translate_again");
    expect(again.statusCode, again.body).toBe(200);
    expect((await english())?.state).toBe("stale");
    expect(await queued()).toBe(1);
  });

  it("marks a machine translation reviewed without editing it (FR-045)", async () => {
    await machineTranslate("The coffee maker is in the kitchen pantry.");
    const marked = await act("mark_reviewed");
    expect(marked.statusCode, marked.body).toBe(200);
    expect(await english()).toMatchObject({ state: "current", origin: "reviewed" });
  });

  it("refuses actions on the item's own language and bad languages", async () => {
    expect((await act("keep", "es")).statusCode).toBe(422);
    expect((await act("keep", "fr")).statusCode).toBe(422);
    const agent = await wsApi(
      ctx,
      team.agent,
      "POST",
      team.workspaceId,
      path(`/items/${itemId}/translations/en`),
      { revision: await revision(), action: "keep" },
    );
    expect(agent.statusCode).toBe(403);
  });

  it("drops a removed language from the draft but not from the published version (FR-048)", async () => {
    const check = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, path("/publish-check"))
    ).json() as PublishCheck;
    const published = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/publish"), {
      expectedRevisionHash: check.revisionHash,
    });
    expect(published.statusCode, published.body).toBe(201);

    const removed = await wsApi(
      ctx,
      team.owner,
      "PATCH",
      team.workspaceId,
      `/properties/${propertyId}`,
      {
        guideLanguages: ["es"],
      },
    );
    expect(removed.statusCode, removed.body).toBe(200);
    expect(await english()).toBeUndefined();
    const { rows } = await db.query<{ snapshot: unknown }>(
      `SELECT v.snapshot FROM guide_version v JOIN guide g ON g.id = v.guide_id WHERE g.property_id = $1`,
      [propertyId],
    );
    expect(JSON.stringify(rows[0]?.snapshot)).toContain("kitchen pantry");
  });

  it("translates every section when a language is added", async () => {
    await db.query(`DELETE FROM pgboss.job WHERE name = 'guide.translate'`);
    const added = await wsApi(
      ctx,
      team.owner,
      "PATCH",
      team.workspaceId,
      `/properties/${propertyId}`,
      {
        guideLanguages: ["es", "en"],
      },
    );
    expect(added.statusCode, added.body).toBe(200);
    expect(await english()).toMatchObject({ state: "stale", origin: "machine" });
    expect(await queued()).toBe(1);
  });
});
