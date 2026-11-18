import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  ASSISTANT_TOPICS,
  type AssistantGroups,
  type PropertyAssistant,
  type WorkspaceAssistant,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { publishedGuide, type PublishedGuide } from "./guest-helpers.js";
import { seedTeam, wsApi, type Member, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Assistant settings for members (feature 007 US1, US3, US4, T013, T025, T030): defaults, the
 * workspace's levels, a property's own groups kept while it follows, roles, concurrent saves,
 * quiet hours and contacts validation, custom instructions as versions, and the security log
 * without instruction text. Fictional data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let other: TeamWorkspace;
let published: PublishedGuide;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "assistant");
  other = await seedTeam(ctx, db, "assistant-other");
  published = await publishedGuide(ctx, team);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const call = (member: Member, method: "GET" | "PUT", suffix: string, payload?: object) =>
  wsApi(ctx, member, method, team.workspaceId, suffix, payload);

const levels = (level: "draft" | "auto" | "full_auto") =>
  Object.fromEntries(
    ASSISTANT_TOPICS.map((topic) => [topic, level]),
  ) as AssistantGroups["autonomy"];

const groups = (patch: Partial<AssistantGroups> = {}): AssistantGroups => ({
  autonomy: levels("draft"),
  tone: "casual",
  quietHours: { enabled: false, start: null, end: null },
  contacts: { mode: "all" },
  ...patch,
});

async function events(targetId: string) {
  const { rows } = await db.query<{ metadata: Record<string, unknown>; actor: string }>(
    `SELECT metadata, actor_user_id AS actor FROM security_event
      WHERE type = 'assistant.settings_changed' AND target_id = $1 ORDER BY occurred_at`,
    [targetId],
  );
  return rows;
}

const propertyUrl = () => `/properties/${published.propertyId}/assistant`;

describe("workspace defaults (feature 007 US1)", () => {
  it("starts at draft everywhere and lists members for contacts", async () => {
    const read = await call(team.agent, "GET", "/assistant");
    expect(read.statusCode, read.body).toBe(200);
    const body = read.json() as WorkspaceAssistant;
    expect(body).toMatchObject({ version: 0, ...groups(), instructions: null, canEdit: false });
    // Agents see only themselves among the members (spec 001 RLS); owners see everyone.
    expect(body.members.map((member) => member.role)).toEqual(["agent"]);
    const asOwner = (await call(team.owner, "GET", "/assistant")).json() as WorkspaceAssistant;
    expect(asOwner.canEdit).toBe(true);
    expect(asOwner.members.map((member) => member.role).sort()).toEqual([
      "admin",
      "agent",
      "owner",
    ]);
  });

  it("lets owners and admins save, logs the changed groups, and refuses agents", async () => {
    const input = {
      version: 0,
      ...groups({ autonomy: { ...levels("draft"), wifi: "auto", parking: "full_auto" } }),
      instructions: "",
    };
    const denied = await call(team.agent, "PUT", "/assistant", input);
    expect(denied.statusCode).toBe(403);
    const saved = await call(team.admin, "PUT", "/assistant", input);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      version: 1,
      autonomy: { wifi: "auto", parking: "full_auto" },
    });
    expect(await events(team.workspaceId)).toEqual([
      { metadata: { scope: "workspace", autonomy: true }, actor: team.admin.userId },
    ]);
    // Saving the same values again changes nothing and logs nothing.
    const same = await call(team.owner, "PUT", "/assistant", { ...input, version: 1 });
    expect(same.json()).toMatchObject({ version: 2 });
    expect(await events(team.workspaceId)).toHaveLength(1);
  });

  it("refuses a save based on an old version", async () => {
    const current = (await call(team.owner, "GET", "/assistant")).json() as WorkspaceAssistant;
    const stale = await call(team.owner, "PUT", "/assistant", {
      version: current.version - 1,
      ...groups({ tone: "formal" }),
      instructions: "",
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: "settings_changed" });
    expect(((await call(team.owner, "GET", "/assistant")).json() as WorkspaceAssistant).tone).toBe(
      "casual",
    );
  });

  it("rejects unknown levels, missing topics, and equal quiet hours", async () => {
    for (const bad of [
      { ...groups(), autonomy: { ...levels("draft"), wifi: "always" } },
      { ...groups(), autonomy: { wifi: "auto" } },
      { ...groups(), quietHours: { enabled: true, start: "22:00", end: "22:00" } },
      { ...groups(), quietHours: { enabled: true, start: "25:00", end: "07:00" } },
    ]) {
      const response = await call(team.owner, "PUT", "/assistant", {
        version: 0,
        ...bad,
        instructions: "",
      });
      expect(response.statusCode, JSON.stringify(bad)).toBe(422);
      expect(response.json()).toMatchObject({ code: "validation_failed" });
    }
  });
});

describe("property values (feature 007 US1, FR-014)", () => {
  it("follows the workspace, sets its own groups, and keeps them while following again", async () => {
    const before = (await call(team.agent, "GET", propertyUrl())).json() as PropertyAssistant;
    expect(before).toMatchObject({
      version: 0,
      follows: { autonomy: true, tone: true, quietHours: true, contacts: true },
      timeZone: "America/Costa_Rica",
      hasPublishedGuide: true,
      canEdit: false,
    });
    expect(before.effective.autonomy.wifi).toBe("auto");
    expect(before.own.autonomy.wifi).toBe("auto");

    const own = {
      version: 0,
      follows: { autonomy: false, tone: true, quietHours: true, contacts: true },
      own: groups({ autonomy: levels("draft") }),
      instructions: "",
    };
    expect((await call(team.agent, "PUT", propertyUrl(), own)).statusCode).toBe(403);
    const saved = await call(team.owner, "PUT", propertyUrl(), own);
    expect(saved.statusCode, saved.body).toBe(200);
    expect((saved.json() as PropertyAssistant).effective.autonomy.wifi).toBe("draft");

    const follow = await call(team.owner, "PUT", propertyUrl(), {
      ...own,
      version: 1,
      follows: { autonomy: true, tone: true, quietHours: true, contacts: true },
    });
    const followed = follow.json() as PropertyAssistant;
    expect(followed.effective.autonomy.wifi).toBe("auto");
    expect(followed.own.autonomy.wifi).toBe("draft");
    expect((await events(published.propertyId)).map((row) => row.metadata)).toEqual([
      { scope: "property", propertyId: published.propertyId, follows: true },
      { scope: "property", propertyId: published.propertyId, follows: true },
    ]);
  });
});

describe("quiet hours and contacts (feature 007 US3)", () => {
  it("needs the property's time zone for quiet hours", async () => {
    await db.query(`UPDATE property SET time_zone = NULL WHERE id = $1`, [published.propertyId]);
    const current = (await call(team.owner, "GET", propertyUrl())).json() as PropertyAssistant;
    const response = await call(team.owner, "PUT", propertyUrl(), {
      version: current.version,
      follows: { autonomy: true, tone: true, quietHours: false, contacts: true },
      own: groups({ quietHours: { enabled: true, start: "22:00", end: "07:00" } }),
      instructions: "",
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "time_zone_required" });
    await db.query(`UPDATE property SET time_zone = 'America/Costa_Rica' WHERE id = $1`, [
      published.propertyId,
    ]);
  });

  it("saves chosen contacts and refuses another workspace's member", async () => {
    const current = (await call(team.owner, "GET", "/assistant")).json() as WorkspaceAssistant;
    const agent = current.members.find((member) => member.role === "agent")!;
    const saved = await call(team.owner, "PUT", "/assistant", {
      version: current.version,
      ...groups({
        autonomy: current.autonomy,
        contacts: { mode: "selected", memberIds: [agent.id] },
        quietHours: { enabled: true, start: "22:00", end: "07:00" },
      }),
      instructions: "",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json()).toMatchObject({
      contacts: { mode: "selected", memberIds: [agent.id] },
      quietHours: { enabled: true, start: "22:00", end: "07:00" },
    });
    const foreign = (
      (
        await wsApi(ctx, other.owner, "GET", other.workspaceId, "/assistant")
      ).json() as WorkspaceAssistant
    ).members[0]!;
    const refused = await call(team.owner, "PUT", "/assistant", {
      version: current.version + 1,
      ...groups({ contacts: { mode: "selected", memberIds: [foreign.id] } }),
      instructions: "",
    });
    expect(refused.statusCode).toBe(404);
  });
});

describe("tone and instructions (feature 007 US4)", () => {
  it("refuses instructions with codes, links, contact data, or off-platform requests", async () => {
    const current = (await call(team.owner, "GET", "/assistant")).json() as WorkspaceAssistant;
    const base = { version: current.version, ...groups({ autonomy: current.autonomy }) };
    for (const [text, issue] of [
      ["El código de la puerta es 4821", "restricted_value"],
      ["Mándalos a https://example.com", "link"],
      ["Escríbanme a host@example.com", "email"],
      ["Llámenme al +506 8888 1234", "phone"],
      ["Invítalos a reservar directo con nosotros", "off_platform"],
      ["a".repeat(1001), "too_long"],
    ] as const) {
      const response = await call(team.owner, "PUT", "/assistant", { ...base, instructions: text });
      expect(response.statusCode, text.slice(0, 30)).toBe(422);
      const body = response.json() as { code: string; issues: string[] };
      expect(body.code).toBe("instructions_invalid");
      expect(body.issues).toContain(issue);
    }
    const unchanged = (await call(team.owner, "GET", "/assistant")).json() as WorkspaceAssistant;
    expect(unchanged.version).toBe(current.version);
    expect(unchanged.instructions).toBeNull();
  });

  it("stores each text as a new version, clears it, and never logs the text", async () => {
    const current = (await call(team.owner, "GET", "/assistant")).json() as WorkspaceAssistant;
    const base = { ...groups({ autonomy: current.autonomy, tone: "formal" }) };
    const first = await call(team.owner, "PUT", "/assistant", {
      version: current.version,
      ...base,
      instructions: "Firma como el equipo de Casa Colibrí.",
    });
    expect(first.statusCode, first.body).toBe(200);
    expect((first.json() as WorkspaceAssistant).instructions).toMatchObject({
      text: "Firma como el equipo de Casa Colibrí.",
    });
    const second = await call(team.owner, "PUT", "/assistant", {
      version: current.version + 1,
      ...base,
      instructions: "Sugiere caminar a la playa.",
    });
    expect(second.statusCode).toBe(200);
    const cleared = await call(team.owner, "PUT", "/assistant", {
      version: current.version + 2,
      ...base,
      instructions: "  ",
    });
    expect((cleared.json() as WorkspaceAssistant).instructions).toBeNull();
    const { rows } = await db.query<{ text: string }>(
      `SELECT text FROM assistant_instruction_version WHERE workspace_id = $1 AND property_id IS NULL ORDER BY created_at`,
      [team.workspaceId],
    );
    expect(rows.map((row) => row.text)).toEqual([
      "Firma como el equipo de Casa Colibrí.",
      "Sugiere caminar a la playa.",
    ]);
    const logged = JSON.stringify(await events(team.workspaceId));
    expect(logged).not.toMatch(/Firma|playa/);
    expect(logged).toContain('"instructions":true');
    expect(logged).toContain('"tone":true');
  });

  it("keeps workspace and property instructions apart", async () => {
    const current = (await call(team.owner, "GET", propertyUrl())).json() as PropertyAssistant;
    const saved = await call(team.owner, "PUT", propertyUrl(), {
      version: current.version,
      follows: current.follows,
      own: current.own,
      instructions: "En esta casa, recomienda la soda de la esquina.",
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const body = saved.json() as PropertyAssistant;
    expect(body.instructions?.text).toBe("En esta casa, recomienda la soda de la esquina.");
    expect(body.workspace.instructions).toBeNull();
  });
});
