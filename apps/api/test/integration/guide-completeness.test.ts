import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CompletenessView, GuideView, PropertyDetail } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Completeness (feature 003 T079, FR-030 to FR-033): missing topics heaviest first, marks that stay
 * until removed, and a score that needs no AI, so it keeps working at the daily AI limit. Fictional
 * text only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let propertyId: string;

const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "completeness");
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Completa",
  });
  propertyId = (created.json() as PropertyDetail).id;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const path = (suffix = "") => `/properties/${propertyId}/guide${suffix}`;

async function completeness(member = team.owner): Promise<CompletenessView> {
  const response = await wsApi(ctx, member, "GET", team.workspaceId, path("/completeness"));
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as CompletenessView;
}

describe("completeness (US4)", () => {
  it("lists missing topics heaviest first, with section and guide scores (FR-030, FR-033)", async () => {
    const result = await completeness(team.agent);
    expect(result.guide).toBeGreaterThanOrEqual(0);
    expect(result.guide).toBeLessThan(100);
    expect(Object.keys(result.sections)).toContain("arrival");
    const weights = result.missing.map((topic) => topic.weight);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("keeps a mark until the host removes it (FR-032)", async () => {
    const before = await completeness();
    const topic = before.missing.find((entry) => entry.topicId === "wifi.troubleshooting")!;
    expect(topic).toBeDefined();
    const marked = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path("/topics/wifi.troubleshooting"),
      { mark: "not_applicable" },
    );
    expect(marked.statusCode, marked.body).toBe(200);
    const after = await completeness();
    expect(after.marks).toMatchObject({ "wifi.troubleshooting": "not_applicable" });
    expect(after.missing.map((entry) => entry.topicId)).not.toContain("wifi.troubleshooting");
    expect(after.guide).toBeGreaterThanOrEqual(before.guide);

    // An unrelated edit leaves the mark alone.
    const view = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, path())
    ).json() as GuideView;
    const wifi = view.sections.find((section) => section.kind === "wifi")!;
    await wsApi(ctx, team.owner, "POST", team.workspaceId, path(`/sections/${wifi.id}/items`), {
      revision: wifi.revision,
      kind: "text",
      language: "es",
      doc: doc("La red se llama Casa Completa."),
    });
    expect((await completeness()).marks).toMatchObject({
      "wifi.troubleshooting": "not_applicable",
    });

    const removed = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path("/topics/wifi.troubleshooting"),
      { mark: null },
    );
    expect(removed.statusCode, removed.body).toBe(200);
    expect((await completeness()).missing.map((entry) => entry.topicId)).toContain(
      "wifi.troubleshooting",
    );
  });

  it("keeps scoring when the daily AI limit is used (FR-031)", async () => {
    // A limit of 1, already used today.
    await db.query(`UPDATE workspace SET guide_ai_daily_limit = 1 WHERE id = $1`, [
      team.workspaceId,
    ]);
    await db.query(
      `INSERT INTO rate_limit_bucket (key, window_start, count)
       VALUES ($1, date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC', 5)
       ON CONFLICT (key, window_start) DO UPDATE SET count = 5`,
      [`guide-ai:${team.workspaceId}:${new Date().toISOString().slice(0, 10)}`],
    );
    try {
      const view = (
        await wsApi(ctx, team.owner, "GET", team.workspaceId, path())
      ).json() as GuideView;
      const appliances = view.sections.find((section) => section.kind === "appliances")!;
      const before = (await completeness()).sections.appliances ?? 0;
      const saved = await wsApi(
        ctx,
        team.owner,
        "POST",
        team.workspaceId,
        path(`/sections/${appliances.id}/items`),
        {
          revision: appliances.revision,
          kind: "text",
          language: "es",
          doc: doc("El aire acondicionado se enciende con el control remoto."),
        },
      );
      expect(saved.statusCode, saved.body).toBe(201);
      expect((await completeness()).sections.appliances ?? 0).toBeGreaterThan(before);
    } finally {
      await db.query(`UPDATE workspace SET guide_ai_daily_limit = NULL WHERE id = $1`, [
        team.workspaceId,
      ]);
    }
  });
});
