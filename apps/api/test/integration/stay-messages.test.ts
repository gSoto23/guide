import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { GuideView } from "@guidesk/contracts";
import { asksOffPlatform } from "@guidesk/domain";
import { systemQuery } from "./helpers.js";
import {
  addStay,
  guideApi,
  LOCKBOX,
  publishedGuide,
  WIFI_PASSWORD,
  type PublishedGuide,
} from "./guest-helpers.js";
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The stay message (feature 004 US4, T051): the published Arrival and Wi-Fi sections as text,
 * locked fields as labels unless values are asked for after a recent sign-in, the export recorded,
 * agents refused, and drafts never used. All values are fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let published: PublishedGuide;
let stayId: string;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "staymessages");
  published = await publishedGuide(ctx, team);
  stayId = await addStay(ctx, team, published.propertyId, 1);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const message = (member: TeamWorkspace["owner"], body: object, id = stayId) =>
  guideApi(ctx, member, team, published.propertyId, "POST", `/share/stays/${id}/message`, body);

describe("stay message (feature 004 US4)", () => {
  it("builds the Spanish message with labels instead of codes (FR-039, FR-040)", async () => {
    const response = await message(team.owner, { language: "es", withValues: false });
    expect(response.statusCode, response.body).toBe(200);
    const { text } = response.json() as { text: string };
    expect(text).toMatch(/\/s\/[A-Za-z0-9_-]{43}/);
    expect(text).toContain("15:00");
    expect(text).toContain("Calle Ficticia 123");
    expect(text).toContain(
      "Abre la caja de llaves con Caja de llaves (lo ves en tu enlace de estadía).",
    );
    expect(text).toContain(
      "Red: CasaColibri. Clave: Contraseña del wifi (lo ves en tu enlace de estadía)",
    );
    expect(text).not.toContain(LOCKBOX);
    expect(text).not.toContain(WIFI_PASSWORD);
    expect(text).toMatch(/opcional/);
    expect(asksOffPlatform(text)).toBe(false);
    const { rows } = await db.query(
      `SELECT 1 FROM security_event WHERE workspace_id = $1 AND type = 'restricted_value.exported'`,
      [team.workspaceId],
    );
    expect(rows).toHaveLength(0);
  });

  it("includes the values when asked, after a recent sign-in, and records the export", async () => {
    const response = await message(team.admin, { language: "en", withValues: true });
    expect(response.statusCode, response.body).toBe(200);
    const { text } = response.json() as { text: string };
    expect(text).toContain(LOCKBOX);
    expect(text).toContain(WIFI_PASSWORD);
    const { rows } = await db.query<{ metadata: Record<string, unknown> }>(
      `SELECT metadata FROM security_event WHERE workspace_id = $1 AND type = 'restricted_value.exported'`,
      [team.workspaceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({ stayId, fields: 2, language: "en" });
    await db.query(
      `UPDATE session_assurance SET strong_auth_at = now() - interval '1 hour' WHERE user_id = $1`,
      [team.admin.userId],
    );
    const stale = await message(team.admin, { language: "en", withValues: true });
    expect(stale.json()).toMatchObject({ code: "step_up_required" });
  });

  it("refuses agents and ineligible stays", async () => {
    expect((await message(team.agent, { language: "es", withValues: false })).statusCode).toBe(403);
    const past = await addStay(ctx, team, published.propertyId, 2);
    await db.query(
      `UPDATE stay SET check_in_date = current_date - 9, checkout_date = current_date - 6 WHERE id = $1`,
      [past],
    );
    expect((await message(team.owner, { language: "es" }, past)).json()).toMatchObject({
      code: "stay_not_eligible",
    });
  });

  it("uses the published version, never the draft", async () => {
    const view = (
      await guideApi(ctx, team.owner, team, published.propertyId, "GET", "/guide")
    ).json() as GuideView;
    const arrival = view.sections.find((section) => section.kind === "arrival")!;
    await guideApi(
      ctx,
      team.owner,
      team,
      published.propertyId,
      "POST",
      `/guide/sections/${arrival.id}/items`,
      {
        revision: arrival.revision,
        kind: "text",
        language: "es",
        doc: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Paso en borrador" }] }],
        },
      },
    );
    const { text } = (await message(team.owner, { language: "es" })).json() as { text: string };
    expect(text).not.toContain("Paso en borrador");
  });
});
