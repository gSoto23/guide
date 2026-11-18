import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuideView, PropertyDetail, SectionWriteResult } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The guide API (feature 003 US1, T039): the draft review, sections, items, approvals, revision
 * checks (FR-012), limits (FR-002, FR-010, FR-014), completeness in the save (FR-031), and agents
 * reading only (AC-SEC-001).
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
  team = await seedTeam(ctx, db, "guides");
  await db.query(`UPDATE workspace SET property_limit = 10 WHERE id = $1`, [team.workspaceId]);
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Colibrí",
  });
  propertyId = (created.json() as PropertyDetail).id;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const path = (suffix = "") => `/properties/${propertyId}/guide${suffix}`;

async function guideAs(member = team.owner): Promise<GuideView> {
  const response = await wsApi(ctx, member, "GET", team.workspaceId, path());
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as GuideView;
}

function sectionOf(view: GuideView, kind: string) {
  return view.sections.find((section) => section.kind === kind)!;
}

async function roleDenials(): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE workspace_id = $1 AND type = 'access.role_denied'`,
    [team.workspaceId],
  );
  return rows[0]?.count ?? 0;
}

describe("the guide draft (US1)", () => {
  it("shows the nine sections in order with facts, statuses, and completeness", async () => {
    const view = await guideAs();
    expect(view.sections.map((section) => section.kind)).toEqual([
      "arrival",
      "wifi",
      "house_rules",
      "appliances",
      "amenities",
      "parking",
      "local_recommendations",
      "emergency",
      "checkout",
    ]);
    expect(view.facts).toMatchObject({ checkInTime: "15:00", checkoutTime: "11:00", maxGuests: 4 });
    expect(sectionOf(view, "arrival").items.map((item) => item.factKey)).toEqual([
      "check_in_time",
      "address",
    ]);
    expect(sectionOf(view, "wifi").status).toBe("missing");
    expect(view.status).toBe("draft");
    expect(view.missingTopics.length).toBeGreaterThan(0);
    expect(view.canEdit).toBe(true);
  });

  it("adds text, approves, and recomputes completeness in the save (FR-031)", async () => {
    const before = await guideAs();
    const appliances = sectionOf(before, "appliances");
    const created = await wsApi(
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
    expect(created.statusCode, created.body).toBe(201);
    const result = created.json() as SectionWriteResult;
    expect(result.section.status).toBe("ready");
    expect(result.section.revision).toBe(appliances.revision + 1);
    expect(result.item).toMatchObject({ source: "host", reviewed: true, sourceLanguage: "es" });
    expect(result.guide.completeness).toBeGreaterThan(before.completeness);
  });

  it("refuses a stale revision with section_changed (FR-012)", async () => {
    const view = await guideAs();
    const appliances = sectionOf(view, "appliances");
    const stale = await wsApi(
      ctx,
      team.admin,
      "POST",
      team.workspaceId,
      path(`/sections/${appliances.id}/items`),
      {
        revision: appliances.revision - 1,
        kind: "text",
        language: "es",
        doc: doc("Otra cosa"),
      },
    );
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "section_changed", revision: appliances.revision });
  });

  it("stores only valid documents (AC-SEC-008) and refuses sections over 20,000 characters (FR-010)", async () => {
    const view = await guideAs();
    const rules = sectionOf(view, "house_rules");
    const script = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/sections/${rules.id}/items`),
      {
        revision: rules.revision,
        kind: "text",
        language: "es",
        doc: {
          type: "doc",
          content: [{ type: "script", content: [{ type: "text", text: "alert(1)" }] }],
        },
      },
    );
    expect(script.statusCode).toBe(422);
    const long = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/sections/${rules.id}/items`),
      {
        revision: rules.revision,
        kind: "text",
        language: "es",
        doc: doc("a".repeat(19_999)),
      },
    );
    expect(long.statusCode, long.body).toBe(201);
    const after = (long.json() as SectionWriteResult).section;
    const tooMuch = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/sections/${rules.id}/items`),
      {
        revision: after.revision,
        kind: "text",
        language: "es",
        doc: doc("bc"),
      },
    );
    expect(tooMuch.statusCode).toBe(422);
    expect(tooMuch.json()).toMatchObject({ code: "text_too_long" });
  });

  it("warns about code-like text without echoing it, and keeps it on request (FR-023)", async () => {
    const view = await guideAs();
    const arrival = sectionOf(view, "arrival");
    const created = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/sections/${arrival.id}/items`),
      {
        revision: arrival.revision,
        kind: "text",
        language: "es",
        doc: doc("El código de la puerta es 4821"),
      },
    );
    const result = created.json() as SectionWriteResult;
    expect(result.warnings).toEqual([{ kind: "door_code", language: "es", blockIndex: 0 }]);
    expect(JSON.stringify(result.warnings)).not.toContain("4821");
    const kept = await wsApi(
      ctx,
      team.owner,
      "PATCH",
      team.workspaceId,
      path(`/items/${result.item!.id}`),
      {
        revision: result.section.revision,
        language: "es",
        keepCodeWarning: true,
      },
    );
    expect(kept.statusCode, kept.body).toBe(200);
    expect((kept.json() as SectionWriteResult).warnings).toEqual([]);
  });

  it("asks for the benefit answer on recommendations (FR-014, PC-07)", async () => {
    const view = await guideAs();
    const local = sectionOf(view, "local_recommendations");
    const missing = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/sections/${local.id}/items`),
      {
        revision: local.revision,
        kind: "recommendation",
        language: "es",
        recommendation: { name: "Soda Tapia", category: "restaurant" },
      },
    );
    expect(missing.json()).toMatchObject({ code: "benefit_required" });
    const ok = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/sections/${local.id}/items`),
      {
        revision: local.revision,
        kind: "recommendation",
        language: "es",
        recommendation: {
          name: "Soda Tapia",
          category: "restaurant",
          benefit: "none",
          personalTip: true,
        },
        doc: doc("Casados ricos y baratos."),
      },
    );
    expect(ok.statusCode, ok.body).toBe(201);
  });

  it("hides default sections, manages custom sections, and limits them to 10 (FR-002)", async () => {
    let view = await guideAs();
    const parking = sectionOf(view, "parking");
    const hidden = await wsApi(
      ctx,
      team.owner,
      "PATCH",
      team.workspaceId,
      path(`/sections/${parking.id}`),
      {
        revision: parking.revision,
        hidden: true,
      },
    );
    expect((hidden.json() as SectionWriteResult).section).toMatchObject({
      hidden: true,
      completeness: null,
    });
    view = await guideAs();
    expect(view.missingTopics.some((topic) => topic.sectionKind === "parking")).toBe(false);

    const pool = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/sections"), {
      title: { es: "Piscina" },
    });
    expect(pool.statusCode, pool.body).toBe(201);
    const poolSection = (pool.json() as SectionWriteResult).section;
    const renamed = await wsApi(
      ctx,
      team.owner,
      "PATCH",
      team.workspaceId,
      path(`/sections/${poolSection.id}`),
      {
        revision: poolSection.revision,
        title: { es: "Piscina y jacuzzi" },
      },
    );
    expect((renamed.json() as SectionWriteResult).section.title).toEqual({
      es: "Piscina y jacuzzi",
    });
    for (let index = 1; index < 10; index += 1) {
      const extra = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/sections"), {
        title: { es: `Extra ${index}` },
      });
      expect(extra.statusCode).toBe(201);
    }
    const eleventh = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/sections"), {
      title: { es: "Once" },
    });
    expect(eleventh.json()).toMatchObject({ code: "section_limit" });
    const removed = await wsApi(
      ctx,
      team.owner,
      "DELETE",
      team.workspaceId,
      path(`/sections/${poolSection.id}`),
    );
    expect(removed.statusCode, removed.body).toBe(200);
    const defaultDelete = await wsApi(
      ctx,
      team.owner,
      "DELETE",
      team.workspaceId,
      path(`/sections/${parking.id}`),
    );
    expect(defaultDelete.statusCode).toBe(422);
  });

  it("approves unreviewed items and marks topics (FR-005, FR-032)", async () => {
    const view = await guideAs();
    const amenities = sectionOf(view, "amenities");
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO guide_item (workspace_id, section_id, kind, position, source, source_language)
       VALUES ($1, $2, 'text', 5, 'listing', 'es') RETURNING id`,
      [team.workspaceId, amenities.id],
    );
    await db.query(
      `INSERT INTO guide_item_text (item_id, language, workspace_id, doc, text_length, origin)
       VALUES ($1, 'es', $2, $3, 7, 'source')`,
      [rows[0]!.id, team.workspaceId, JSON.stringify(doc("Piscina"))],
    );
    const pending = sectionOf(await guideAs(), "amenities");
    expect(pending.status).toBe("needs_review");
    const approved = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/sections/${amenities.id}/approve`),
      {
        revision: pending.revision,
      },
    );
    expect((approved.json() as SectionWriteResult).section.status).toBe("ready");

    const marked = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path("/topics/wifi.troubleshooting"),
      {
        mark: "not_applicable",
      },
    );
    expect((marked.json() as GuideView).topicMarks).toMatchObject({
      "wifi.troubleshooting": "not_applicable",
    });
    const unknown = await wsApi(ctx, team.owner, "PUT", team.workspaceId, path("/topics/made.up"), {
      mark: "covered",
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("lets agents read the guide and refuses every write, logging the refusal (AC-SEC-001)", async () => {
    const view = await guideAs(team.agent);
    expect(view.canEdit).toBe(false);
    const before = await roleDenials();
    const wifi = sectionOf(view, "wifi");
    const writes = [
      wsApi(ctx, team.agent, "POST", team.workspaceId, path(`/sections/${wifi.id}/items`), {
        revision: wifi.revision,
        kind: "text",
        language: "es",
        doc: doc("Red: Colibri"),
      }),
      wsApi(ctx, team.agent, "POST", team.workspaceId, path("/sections"), {
        title: { es: "Agente" },
      }),
      wsApi(ctx, team.agent, "PATCH", team.workspaceId, path(`/sections/${wifi.id}`), {
        revision: wifi.revision,
        hidden: true,
      }),
      wsApi(ctx, team.agent, "PUT", team.workspaceId, path("/topics/wifi.network"), {
        mark: "covered",
      }),
    ];
    for (const response of await Promise.all(writes)) expect(response.statusCode).toBe(403);
    expect(await roleDenials()).toBeGreaterThanOrEqual(before + 4);
  });

  it("answers 404 for another workspace's property and section", async () => {
    const other = await seedTeam(ctx, db, "guides-other");
    const response = await wsApi(ctx, other.owner, "GET", other.workspaceId, path());
    expect(response.statusCode).toBe(404);
    const view = await guideAs();
    const foreign = await wsApi(
      ctx,
      other.owner,
      "PATCH",
      other.workspaceId,
      path(`/sections/${view.sections[0]!.id}`),
      { revision: 0, hidden: true },
    );
    expect(foreign.statusCode).toBe(404);
  });
});
