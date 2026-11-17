import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { withRlsContext, type DbHandle } from "@guidesk/db";
import { REQUEST_DB_HANDLE } from "../../src/database/database.module.js";
import { UploadsService, type UploadForm } from "../../src/uploads/uploads.service.js";
import { systemQuery } from "./helpers.js";
import { newOwner } from "./invitation-helpers.js";
import { createTestApp, PORTAL_URL } from "./test-app.js";

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let uploads: UploadsService;
let requestDb: DbHandle;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  uploads = ctx.app.get(UploadsService);
  requestDb = ctx.app.get<DbHandle>(REQUEST_DB_HANDLE);
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

async function ownerForms(
  purpose: "screenshot" | "csv",
  files: { contentType: string; size: number }[],
) {
  const owner = await newOwner(ctx, "uploads");
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT user_id FROM membership WHERE workspace_id = $1 AND role = 'owner'`,
    [owner.workspaceId],
  );
  const userId = rows[0]!.user_id;
  const forms = await withRlsContext(
    requestDb.db,
    { userId, workspaceId: owner.workspaceId },
    (tx) =>
      uploads.createUploads(tx, {
        workspaceId: owner.workspaceId,
        purpose,
        files,
        createdBy: userId,
      }),
  );
  return { owner, forms };
}

/** Posts a presigned form the way a browser does: the fields, then the file last. */
async function post(form: UploadForm, file: { type: string; bytes: Buffer }, fields = form.fields) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  data.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.type }), "listing.png");
  const request = new Request("http://localhost/upload", { method: "POST", body: data });
  return ctx.fastify.inject({
    method: "POST",
    url: new URL(form.url).pathname,
    headers: { origin: PORTAL_URL, "content-type": request.headers.get("content-type") ?? "" },
    payload: Buffer.from(await request.arrayBuffer()),
  });
}

describe("presigned uploads (T022, research R9, SEC-10)", () => {
  it("creates rows keyed by workspace and upload ID, expiring after 24 hours", async () => {
    const { owner, forms } = await ownerForms("screenshot", [
      { contentType: "image/png", size: 2048 },
      { contentType: "image/jpeg", size: 4096 },
    ]);
    expect(forms).toHaveLength(2);
    const { rows } = await db.query<{
      id: string;
      object_key: string;
      status: string;
      hours: number;
    }>(
      `SELECT id, object_key, status, extract(epoch FROM expires_at - created_at) / 3600 AS hours
       FROM upload WHERE workspace_id = $1 ORDER BY declared_size`,
      [owner.workspaceId],
    );
    expect(rows.map((row) => row.id)).toEqual(forms.map((form) => form.uploadId));
    for (const row of rows) {
      expect(row.object_key).toBe(`uploads/${owner.workspaceId}/${row.id}`);
      expect(row.status).toBe("pending");
      expect(Number(row.hours)).toBeCloseTo(24, 1);
    }
  });

  it("fixes the key, the content type, and the size range in each form, for 10 minutes", async () => {
    const { owner, forms } = await ownerForms("screenshot", [
      { contentType: "image/png", size: 2048 },
    ]);
    const form = forms[0]!;
    expect(form.url).toBe(`${PORTAL_URL}/api/v1/local-uploads`);
    expect(form.fields).toMatchObject({
      key: `uploads/${owner.workspaceId}/${form.uploadId}`,
      "Content-Type": "image/png",
      "x-max-bytes": String(10 * 1024 * 1024),
    });
    const expiresIn = Number(form.fields["x-expires"]) - Date.now() / 1000;
    expect(expiresIn).toBeGreaterThan(590);
    expect(expiresIn).toBeLessThanOrEqual(600);

    const png = Buffer.from("fake-png-bytes");
    expect((await post(form, { type: "image/png", bytes: png })).statusCode).toBe(204);
    expect((await post(form, { type: "application/zip", bytes: png })).statusCode).toBe(403);
    const otherKey = `uploads/${owner.workspaceId}/00000000-0000-4000-8000-000000000000`;
    expect(
      (await post(form, { type: "image/png", bytes: png }, { ...form.fields, key: otherKey }))
        .statusCode,
    ).toBe(403);
  });

  it("limits CSV forms to 2 MB", async () => {
    const { forms } = await ownerForms("csv", [{ contentType: "text/csv", size: 1000 }]);
    expect(forms[0]!.fields["x-max-bytes"]).toBe(String(2 * 1024 * 1024));
    const tooLarge = await post(forms[0]!, {
      type: "text/csv",
      bytes: Buffer.alloc(2 * 1024 * 1024 + 1, 97),
    });
    expect(tooLarge.statusCode).toBe(403);
  });

  it("accepts only the declared types and sizes for each purpose", () => {
    expect(UploadsService.accepts("screenshot", { contentType: "image/webp", size: 1 })).toBe(true);
    expect(UploadsService.accepts("screenshot", { contentType: "image/heic", size: 1 })).toBe(
      false,
    );
    expect(
      UploadsService.accepts("screenshot", {
        contentType: "image/png",
        size: 10 * 1024 * 1024 + 1,
      }),
    ).toBe(false);
    expect(UploadsService.accepts("csv", { contentType: "text/csv", size: 3 * 1024 * 1024 })).toBe(
      false,
    );
  });
});
