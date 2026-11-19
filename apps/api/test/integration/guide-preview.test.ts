import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  GuidePreview,
  GuideView,
  LockedFieldView,
  PropertyDetail,
  PublishCheck,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The preview (feature 003 US3, T072): the draft, the published version, and a numbered version,
 * per language, with locked fields as placeholders and facts resolved from the property at view
 * time (FR-052, FR-054). All codes are fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let propertyId: string;
let lockboxId: string;

// Not a substring any UUID or timestamp in the response can contain, so the check below cannot match by chance.
const LOCKBOX = "TEST-8246";

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "preview");
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Vista",
  });
  propertyId = (created.json() as PropertyDetail).id;
  const field = await wsApi(
    ctx,
    team.owner,
    "POST",
    team.workspaceId,
    `/properties/${propertyId}/guide/locked-fields`,
    { kind: "lockbox_code", label: "Caja de llaves", value: LOCKBOX },
  );
  lockboxId = (field.json() as LockedFieldView).id;
  const view = (
    await wsApi(ctx, team.owner, "GET", team.workspaceId, `/properties/${propertyId}/guide`)
  ).json() as GuideView;
  const arrival = view.sections.find((section) => section.kind === "arrival")!;
  const added = await wsApi(
    ctx,
    team.owner,
    "POST",
    team.workspaceId,
    `/properties/${propertyId}/guide/sections/${arrival.id}/items`,
    {
      revision: arrival.revision,
      kind: "text",
      language: "es",
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Abre la caja con " },
              { type: "lockedField", attrs: { fieldId: lockboxId } },
            ],
          },
        ],
      },
    },
  );
  expect(added.statusCode, added.body).toBe(201);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const path = (suffix = "") => `/properties/${propertyId}/guide${suffix}`;

async function preview(query: string, member = team.owner): Promise<GuidePreview> {
  const response = await wsApi(ctx, member, "GET", team.workspaceId, path(`/preview?${query}`));
  expect(response.statusCode, response.body).toBe(200);
  expect(response.body).not.toContain(LOCKBOX);
  return response.json() as GuidePreview;
}

function arrivalOf(result: GuidePreview) {
  return result.sections.find((section) => section.kind === "arrival")!;
}

describe("the guide preview (US3)", () => {
  it("shows the draft with locked fields as placeholders and facts from the property (FR-054)", async () => {
    const draft = await preview("source=draft&lang=es");
    expect(draft).toMatchObject({
      source: "draft",
      versionNumber: null,
      language: "es",
      languages: ["es", "en"],
      propertyName: "Casa Vista",
    });
    const arrival = arrivalOf(draft);
    expect(arrival.items.find((item) => item.fact?.key === "check_in_time")?.fact).toEqual({
      key: "check_in_time",
      value: "15:00",
    });
    const text = arrival.items.find((item) => item.kind === "text")!;
    expect(JSON.stringify(text.doc)).toContain(lockboxId);
    expect(draft.lockedFields).toContainEqual({
      id: lockboxId,
      kind: "lockbox_code",
      label: "Caja de llaves",
    });
    // Hidden sections are not shown.
    expect(draft.sections.every((section) => section.kind !== "custom")).toBe(true);
  });

  it("falls back to the source text for a language without a translation", async () => {
    const english = await preview("source=draft&lang=en");
    expect(english.language).toBe("en");
    const text = arrivalOf(english).items.find((item) => item.kind === "text")!;
    expect(JSON.stringify(text.doc)).toContain("Abre la caja con");
  });

  it("shows the published and numbered versions, with facts current at view time (FR-052)", async () => {
    const check = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, path("/publish-check"))
    ).json() as PublishCheck;
    const published = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/publish"), {
      expectedRevisionHash: check.revisionHash,
    });
    expect(published.statusCode, published.body).toBe(201);

    await db.query(`UPDATE property SET check_in_time = '16:00' WHERE id = $1`, [propertyId]);
    const live = await preview("source=published", team.agent);
    expect(live).toMatchObject({ source: "published", versionNumber: 1, language: "es" });
    expect(arrivalOf(live).items.find((item) => item.fact?.key === "check_in_time")?.fact).toEqual({
      key: "check_in_time",
      value: "16:00",
    });
    const numbered = await preview("source=1&lang=en");
    expect(numbered).toMatchObject({ source: "version", versionNumber: 1, language: "en" });

    const viewed = await wsApi(ctx, team.agent, "GET", team.workspaceId, path("/versions/1"));
    expect(viewed.statusCode).toBe(200);
    expect((viewed.json() as GuidePreview).versionNumber).toBe(1);
    const missing = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      path("/preview?source=9"),
    );
    expect(missing.statusCode).toBe(404);
  });

  it("refuses a malformed source or language", async () => {
    for (const query of ["source=latest", "source=0", "lang=fr"]) {
      const response = await wsApi(
        ctx,
        team.owner,
        "GET",
        team.workspaceId,
        path(`/preview?${query}`),
      );
      expect(response.statusCode, query).toBe(422);
    }
  });
});
