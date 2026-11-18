import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  GuideView,
  InterviewView,
  LockedFieldView,
  PropertyDetail,
  PublishCheck,
  RevealedValue,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  captureLogs,
  READY_FACTS,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Security review for feature 003 (T121): the acceptance criteria that the API owns, end to end
 * in one guide, with every log line captured and searched for the codes used (SC-004).
 *
 * - AC-SEC-001 agents, AC-SEC-002 step-up, AC-SEC-006 codes never leave the vault except by
 *   reveal, AC-SEC-008 markup, AC-SEC-012 the AI limit, and AC-SEC-013 links: here.
 * - AC-SEC-003 (reveal limit): locked-fields.test.ts. AC-SEC-004 (interview codes):
 *   interview-answer.test.ts and interviews.test.ts. AC-SEC-005, AC-SEC-007, AC-SEC-009
 *   (documents and files): guide-document.test.ts and the sandbox tests. AC-SEC-010 (photo
 *   metadata): media tests. AC-SEC-011 (other workspaces): cross-tenant.test.ts.
 *
 * Every code here is fictional, and six digits long so it cannot match part of an ID by chance.
 */
const LOCKBOX = "846251";
/** A code the host keeps as text in the editor: warned about, never logged (FR-023). */
const IN_EDITOR = "601347";
/** A code typed into the interview: removed before it is stored or sent anywhere. */
const TYPED = "519782";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let propertyId: string;
let fieldId: string;
let logs: ReturnType<typeof captureLogs>;
const bodies: string[] = [];

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "secreview");
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Revisada",
  });
  propertyId = (created.json() as PropertyDetail).id;
  logs = captureLogs();
});

afterAll(async () => {
  logs.stop();
  await db.close();
  await ctx.app.close();
});

const path = (suffix = "") => `/properties/${propertyId}/guide${suffix}`;

async function call(
  member: TeamWorkspace["owner"],
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  suffix: string,
  body?: object,
) {
  const response = await wsApi(ctx, member, method, team.workspaceId, path(suffix), body);
  bodies.push(response.body);
  return response;
}

async function section(kind: string) {
  const view = (await call(team.owner, "GET", "")).json() as GuideView;
  return view.sections.find((candidate) => candidate.kind === kind)!;
}

async function roleDenials(): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE workspace_id = $1 AND type = 'access.role_denied'`,
    [team.workspaceId],
  );
  return rows[0]?.count ?? 0;
}

describe("feature 003 security review (T121)", () => {
  it("stores a code encrypted and reveals it only by the reveal route (AC-SEC-006)", async () => {
    const created = await call(team.owner, "POST", "/locked-fields", {
      kind: "lockbox_code",
      label: "Caja de llaves",
      value: LOCKBOX,
    });
    expect(created.statusCode, created.body).toBe(201);
    fieldId = (created.json() as LockedFieldView).id;
    const arrival = await section("arrival");
    const saved = await call(team.owner, "POST", `/sections/${arrival.id}/items`, {
      revision: arrival.revision,
      kind: "text",
      language: "es",
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "La caja se abre con " },
              { type: "lockedField", attrs: { fieldId } },
            ],
          },
        ],
      },
    });
    expect(saved.statusCode, saved.body).toBe(201);
    const revealed = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/locked-fields/${fieldId}/reveal`),
    );
    expect(revealed.statusCode).toBe(200);
    expect((revealed.json() as RevealedValue).value).toBe(LOCKBOX);
    expect(revealed.headers["cache-control"]).toContain("no-store");
  });

  it("keeps a typed code out of the stored answer and warns about it in the editor (AC-SEC-006)", async () => {
    const rules = await section("house_rules");
    const warned = await call(team.owner, "POST", `/sections/${rules.id}/items`, {
      revision: rules.revision,
      kind: "text",
      language: "es",
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: `El código de la puerta es ${IN_EDITOR}` }],
          },
        ],
      },
    });
    expect(warned.statusCode).toBe(201);
    expect((warned.json() as { warnings: unknown[] }).warnings).toHaveLength(1);
    const interview = (await call(team.owner, "POST", "/interview", {})).json() as InterviewView;
    const answered = await call(team.owner, "POST", `/interview/${interview.sessionId}/answers`, {
      topicId: "checkout.steps",
      text: `Dejen las llaves. La alarma se apaga con el código ${TYPED}.`,
    });
    expect(answered.statusCode, answered.body).toBe(202);
    expect(answered.body).not.toContain(TYPED);
  });

  it("publishes and previews with references only (AC-SEC-006, FR-052)", async () => {
    const check = (await call(team.owner, "GET", "/publish-check")).json() as PublishCheck;
    const published = await call(team.owner, "POST", "/publish", {
      expectedRevisionHash: check.revisionHash,
    });
    expect(published.statusCode, published.body).toBe(201);
    for (const source of ["draft", "published"]) {
      const preview = await call(team.owner, "GET", `/preview?source=${source}`);
      expect(preview.statusCode).toBe(200);
      expect(preview.body).toContain(fieldId);
    }
    const { rows } = await db.query<{ snapshot: string }>(
      `SELECT v.snapshot::text AS snapshot FROM guide_version v JOIN guide g ON g.id = v.guide_id WHERE g.property_id = $1`,
      [propertyId],
    );
    expect(rows[0]?.snapshot).not.toContain(LOCKBOX);
  });

  it("refuses agents every write and every reveal, and logs the refusals (AC-SEC-001)", async () => {
    const before = await roleDenials();
    const arrival = await section("arrival");
    const edit = await call(team.agent, "PATCH", `/sections/${arrival.id}`, {
      revision: arrival.revision,
      hidden: true,
    });
    const add = await call(team.agent, "POST", "/locked-fields", { kind: "door_code" });
    const publish = await call(team.agent, "POST", "/publish", {
      expectedRevisionHash: "0".repeat(64),
    });
    expect([edit.statusCode, add.statusCode, publish.statusCode]).toEqual([403, 403, 403]);
    const reveal = await call(team.agent, "POST", `/locked-fields/${fieldId}/reveal`);
    expect(reveal.statusCode).toBe(404);
    expect(await roleDenials()).toBeGreaterThanOrEqual(before + 3);
  });

  it("asks for a recent sign-in before touching a locked field (AC-SEC-002)", async () => {
    await db.query(
      `UPDATE session_assurance SET strong_auth_at = now() - interval '1 hour' WHERE user_id = $1`,
      [team.admin.userId],
    );
    const stale = await call(team.admin, "POST", `/locked-fields/${fieldId}/reveal`);
    expect(stale.statusCode).toBe(403);
    expect(stale.json()).toMatchObject({ code: "step_up_required" });
  });

  it("refuses markup and unsafe links in documents (AC-SEC-008, AC-SEC-013)", async () => {
    const rules = await section("house_rules");
    for (const doc of [
      { type: "doc", content: [{ type: "html", content: "<script>alert(1)</script>" }] },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "x",
                marks: [{ type: "bold", attrs: { onerror: "alert(1)" } }],
              },
            ],
          },
        ],
      },
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Ver",
                marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
              },
            ],
          },
        ],
      },
    ]) {
      const refused = await call(team.owner, "POST", `/sections/${rules.id}/items`, {
        revision: rules.revision,
        kind: "text",
        language: "es",
        doc,
      });
      expect([400, 422]).toContain(refused.statusCode);
    }
    const safe = await call(team.owner, "POST", `/sections/${rules.id}/items`, {
      revision: rules.revision,
      kind: "text",
      language: "es",
      doc: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "El reglamento",
                marks: [{ type: "link", attrs: { href: "https://example.com/reglamento" } }],
              },
            ],
          },
        ],
      },
    });
    expect(safe.statusCode, safe.body).toBe(201);
    const preview = await call(team.owner, "GET", "/preview?source=draft");
    expect(preview.body).toContain("https://example.com/reglamento");
  });

  it("stops at the daily AI limit without creating work (AC-SEC-012)", async () => {
    await db.query(`UPDATE workspace SET guide_ai_daily_limit = 1 WHERE id = $1`, [
      team.workspaceId,
    ]);
    const interview = (await call(team.owner, "POST", "/interview", {})).json() as InterviewView;
    const refused = await call(team.owner, "POST", `/interview/${interview.sessionId}/answers`, {
      topicId: "wifi.network",
      text: "La red se llama Casa Revisada.",
    });
    expect(refused.statusCode).toBe(429);
    expect(refused.json()).toMatchObject({ code: "ai_limit_reached" });
  });

  it("never writes a code to the logs, the security log, or a response other than reveal (SC-004)", async () => {
    const output = logs.text();
    for (const code of [LOCKBOX, IN_EDITOR, TYPED]) {
      expect(output, `logs contain ${code}`).not.toContain(code);
    }
    // The host's own text comes back to the host; the vault's and the interview's codes never do.
    for (const code of [LOCKBOX, TYPED]) {
      const leaked = bodies.filter((body) => body.includes(code));
      expect(leaked, `responses contain ${code}`).toEqual([]);
    }
    const { rows } = await db.query<{ metadata: string }>(
      `SELECT metadata::text AS metadata FROM security_event WHERE workspace_id = $1`,
      [team.workspaceId],
    );
    for (const row of rows) {
      for (const code of [LOCKBOX, IN_EDITOR, TYPED]) expect(row.metadata).not.toContain(code);
    }
  });
});
