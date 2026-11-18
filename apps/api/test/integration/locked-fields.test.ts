import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  GuideView,
  LockedFieldView,
  PropertyDetail,
  RevealedValue,
  RevealHistory,
  SectionWriteResult,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * Locked fields (feature 003 US2, T060, T061, FR-015 to FR-024, AC-SEC-002, AC-SEC-003, AC-SEC-006):
 * step-up, encrypted values that never appear in a response except the reveal, the per-member
 * reveal limit with the owners' alert, the public Wi-Fi switch, referenced deletes, the reveal
 * history, and code warnings moved into a field. All codes are fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let propertyId: string;

const CODE = "4821";
const WIFI = "Colibri2026";

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "locked");
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Candado",
  });
  propertyId = (created.json() as PropertyDetail).id;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const path = (suffix = "") => `/properties/${propertyId}/guide/locked-fields${suffix}`;

async function count(type: string): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE workspace_id = $1 AND type = $2`,
    [team.workspaceId, type],
  );
  return rows[0]?.count ?? 0;
}

async function addField(body: object, member = team.owner) {
  return wsApi(ctx, member, "POST", team.workspaceId, path(), body);
}

describe("locked fields", () => {
  it("adds a field with its value encrypted, and never returns the value (FR-015, FR-016, AC-SEC-006)", async () => {
    const created = await addField({ kind: "lockbox_code", value: CODE });
    expect(created.statusCode, created.body).toBe(201);
    const field = created.json() as LockedFieldView;
    expect(field).toMatchObject({
      kind: "lockbox_code",
      label: "Código de caja de llaves",
      isSet: true,
      isPublic: false,
      sectionKind: "arrival",
    });
    expect(created.body).not.toContain(CODE);
    const { rows } = await db.query<{ value_ciphertext: Buffer; public_value: string | null }>(
      `SELECT value_ciphertext, public_value FROM restricted_value WHERE id = $1`,
      [field.id],
    );
    expect(rows[0]?.value_ciphertext.includes(Buffer.from(CODE))).toBe(false);
    expect(rows[0]?.public_value).toBeNull();
    const guide = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/properties/${propertyId}/guide`,
    );
    expect(guide.body).not.toContain(CODE);
    expect(await count("restricted_value.added")).toBeGreaterThanOrEqual(1);
  });

  it("asks for a recent sign-in before adding, revealing, changing, or deleting (AC-SEC-002)", async () => {
    const field = (await (
      await addField({ kind: "door_code", value: "1357" })
    ).json()) as LockedFieldView;
    await db.query(
      `UPDATE session_assurance SET strong_auth_at = now() - interval '1 hour' WHERE user_id = $1`,
      [team.admin.userId],
    );
    const attempts = [
      addField({ kind: "gate_code", value: "2468" }, team.admin),
      wsApi(ctx, team.admin, "POST", team.workspaceId, path(`/${field.id}/reveal`)),
      wsApi(ctx, team.admin, "PATCH", team.workspaceId, path(`/${field.id}`), { value: "9999" }),
      wsApi(ctx, team.admin, "DELETE", team.workspaceId, path(`/${field.id}`)),
    ];
    for (const response of await Promise.all(attempts)) {
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: "step_up_required" });
    }
    await db.query(`UPDATE session_assurance SET strong_auth_at = now() WHERE user_id = $1`, [
      team.admin.userId,
    ]);
  });

  it("reveals for 60 seconds with no-store and logs the reveal (FR-016, FR-017)", async () => {
    const field = (await (
      await addField({ kind: "alarm_code", value: "8642" })
    ).json()) as LockedFieldView;
    const revealed = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/${field.id}/reveal`),
    );
    expect(revealed.statusCode, revealed.body).toBe(200);
    expect(revealed.json() as RevealedValue).toEqual({ value: "8642", hideAfterSeconds: 60 });
    expect(revealed.headers["cache-control"]).toBe("no-store");
    const history = (
      await wsApi(ctx, team.admin, "GET", team.workspaceId, path("/reveals"))
    ).json() as RevealHistory;
    expect(history.items[0]).toMatchObject({ fieldId: field.id, kind: "alarm_code" });
    expect(JSON.stringify(history)).not.toContain("8642");
  });

  it("changes a value without echoing it, and takes effect at once (FR-020)", async () => {
    const field = (await (
      await addField({ kind: "gate_code", value: "1111" })
    ).json()) as LockedFieldView;
    const changed = await wsApi(ctx, team.owner, "PATCH", team.workspaceId, path(`/${field.id}`), {
      value: "2222",
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.body).not.toContain("2222");
    const revealed = (
      await wsApi(ctx, team.owner, "POST", team.workspaceId, path(`/${field.id}/reveal`))
    ).json() as RevealedValue;
    expect(revealed.value).toBe("2222");
  });

  it("makes the Wi-Fi password public and locked again, Wi-Fi only (FR-021)", async () => {
    const wifi = (await (
      await addField({ kind: "wifi_password", value: WIFI })
    ).json()) as LockedFieldView;
    expect(wifi).toMatchObject({ sectionKind: "wifi" });
    const made = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path(`/${wifi.id}/visibility`),
      { public: true },
    );
    expect(made.json()).toMatchObject({ isPublic: true, isSet: true });
    let { rows } = await db.query<{ value_ciphertext: Buffer | null; public_value: string | null }>(
      `SELECT value_ciphertext, public_value FROM restricted_value WHERE id = $1`,
      [wifi.id],
    );
    expect(rows[0]).toEqual({ value_ciphertext: null, public_value: WIFI });
    const back = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path(`/${wifi.id}/visibility`),
      { public: false },
    );
    expect(back.json()).toMatchObject({ isPublic: false });
    ({ rows } = await db.query<{ value_ciphertext: Buffer | null; public_value: string | null }>(
      `SELECT value_ciphertext, public_value FROM restricted_value WHERE id = $1`,
      [wifi.id],
    ));
    expect(rows[0]?.public_value).toBeNull();
    expect(rows[0]?.value_ciphertext).not.toBeNull();
    const door = (await (
      await addField({ kind: "door_code", value: "3030" })
    ).json()) as LockedFieldView;
    const refused = await wsApi(
      ctx,
      team.owner,
      "PUT",
      team.workspaceId,
      path(`/${door.id}/visibility`),
      { public: true },
    );
    expect(refused.json()).toMatchObject({ code: "wifi_only" });
    expect(await count("restricted_value.made_public")).toBe(1);
    expect(await count("restricted_value.made_locked")).toBe(1);
  });

  it("lets agents see only that a field is locked (FR-063, AC-SEC-001)", async () => {
    const list = await wsApi(ctx, team.agent, "GET", team.workspaceId, path());
    expect(list.statusCode).toBe(200);
    const fields = list.json() as LockedFieldView[];
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields)
      expect(Object.keys(field).sort()).toEqual(["id", "kind", "label", "locked"]);
    const first = fields[0]!;
    expect(
      (await wsApi(ctx, team.agent, "POST", team.workspaceId, path(`/${first.id}/reveal`)))
        .statusCode,
    ).toBe(404);
    expect(
      (await wsApi(ctx, team.agent, "GET", team.workspaceId, path("/reveals"))).statusCode,
    ).toBe(404);
    expect((await addField({ kind: "door_code", value: "1212" }, team.agent)).statusCode).toBe(403);
  });

  it("stops a member after 20 reveals in an hour and alerts the owners once (FR-018, AC-SEC-003)", async () => {
    const field = (await (
      await addField({ kind: "door_code", value: "5555" })
    ).json()) as LockedFieldView;
    await db.query(`DELETE FROM rate_limit_bucket WHERE key LIKE $1`, [
      `reveal%:${team.workspaceId}:%`,
    ]);
    for (let index = 0; index < 20; index += 1) {
      const response = await wsApi(
        ctx,
        team.admin,
        "POST",
        team.workspaceId,
        path(`/${field.id}/reveal`),
      );
      expect(response.statusCode, `reveal ${index + 1}`).toBe(200);
    }
    const blocked = await wsApi(
      ctx,
      team.admin,
      "POST",
      team.workspaceId,
      path(`/${field.id}/reveal`),
    );
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toMatchObject({ code: "reveal_limit_reached" });
    await wsApi(ctx, team.admin, "POST", team.workspaceId, path(`/${field.id}/reveal`));
    expect(await count("restricted_value.reveal_limited")).toBe(2);
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pgboss.job WHERE name = 'email.send' AND data->>'template' = 'guides.reveal_limit' AND data->>'to' = $1`,
      [team.owner.email],
    );
    expect(rows[0]?.count).toBe(1);
  });

  it("asks before deleting a field a published version uses (FR-024)", async () => {
    const field = (await (
      await addField({ kind: "lockbox_code", value: "7777" })
    ).json()) as LockedFieldView;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO guide_version (workspace_id, guide_id, number, cause, snapshot, snapshot_schema, languages)
       SELECT workspace_id, id, 1, 'publish', $2::jsonb, 1, '{es,en}' FROM guide WHERE property_id = $1 RETURNING id`,
      [
        propertyId,
        JSON.stringify({
          sections: [
            {
              items: [
                {
                  texts: {
                    es: {
                      type: "doc",
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "lockedField", attrs: { fieldId: field.id } }],
                        },
                      ],
                    },
                  },
                },
              ],
            },
          ],
        }),
      ],
    );
    await db.query(
      `UPDATE guide SET published_version_id = $1, status = 'published' WHERE property_id = $2`,
      [rows[0]!.id, propertyId],
    );
    const refused = await wsApi(ctx, team.owner, "DELETE", team.workspaceId, path(`/${field.id}`));
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ code: "locked_field_referenced", version: 1 });
    const confirmed = await wsApi(
      ctx,
      team.owner,
      "DELETE",
      team.workspaceId,
      path(`/${field.id}?confirm=true`),
    );
    expect(confirmed.statusCode).toBe(204);
    await db.query(
      `UPDATE guide SET published_version_id = NULL, status = 'draft' WHERE property_id = $1`,
      [propertyId],
    );
  });
});

describe("code warnings (FR-023)", () => {
  it("moves a detected code into a locked field and replaces it with a reference", async () => {
    const view = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, `/properties/${propertyId}/guide`)
    ).json() as GuideView;
    const arrival = view.sections.find((section) => section.kind === "arrival")!;
    const created = (
      await wsApi(
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
                content: [{ type: "text", text: "La puerta se abre con el código 9182." }],
              },
            ],
          },
        },
      )
    ).json() as SectionWriteResult;
    expect(created.warnings).toEqual([{ kind: "door_code", language: "es", blockIndex: 0 }]);
    const moved = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/properties/${propertyId}/guide/items/${created.item!.id}/move-to-locked-field`,
      {
        revision: created.section.revision,
        language: "es",
        blockIndex: 0,
        kind: "door_code",
      },
    );
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.body).not.toContain("9182");
    const item = (moved.json() as SectionWriteResult).section.items.find(
      (candidate) => candidate.id === created.item!.id,
    )!;
    const content = item.texts.es?.doc?.content[0];
    expect(JSON.stringify(content)).toContain("lockedField");
    const fieldId = (
      content as { content: { type: string; attrs?: { fieldId: string } }[] }
    ).content.find((node) => node.type === "lockedField")!.attrs!.fieldId;
    const revealed = (
      await wsApi(ctx, team.owner, "POST", team.workspaceId, path(`/${fieldId}/reveal`))
    ).json() as RevealedValue;
    expect(revealed.value).toBe("9182");
  });
});
