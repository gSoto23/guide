import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type {
  DocumentList,
  DocumentUpload,
  GuideView,
  PropertyDetail,
  SectionWriteResult,
} from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import { READY_FACTS, seedTeam, wsApi, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The documents API (feature 003 T105, FR-039 to FR-041): up to 10 files per request with
 * presigned forms, the reading queued once, the list with statuses and suggestions, accept, edit,
 * and discard through the item routes, removing a file with its unreviewed suggestions, and agents
 * reading only. Fictional data only.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;
let propertyId: string;
let documentId: string;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "documents");
  const created = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/properties", {
    ...READY_FACTS,
    name: "Casa Manuales",
  });
  propertyId = (created.json() as PropertyDetail).id;
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const path = (suffix = "") => `/properties/${propertyId}/guide${suffix}`;
const pdfFile = (n: number) => ({
  fileName: `manual-${n}.pdf`,
  contentType: "application/pdf",
  size: 50_000,
});

async function list(member = team.owner): Promise<DocumentList> {
  const response = await wsApi(ctx, member, "GET", team.workspaceId, path("/documents"));
  expect(response.statusCode, response.body).toBe(200);
  return response.json() as DocumentList;
}

describe("documents (US6)", () => {
  it("gives one presigned form per file, at most 10 (FR-039)", async () => {
    const tooMany = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/documents"), {
      files: Array.from({ length: 11 }, (_, n) => pdfFile(n)),
    });
    expect(tooMany.statusCode).toBe(422);

    const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/documents"), {
      files: [
        pdfFile(1),
        { fileName: "../../etc/horno\u0007.jpg", contentType: "image/jpeg", size: 200_000 },
      ],
    });
    expect(response.statusCode, response.body).toBe(201);
    const uploads = response.json() as DocumentUpload[];
    expect(uploads).toHaveLength(2);
    expect(uploads[0]!.upload.url).toBeTruthy();
    documentId = uploads[0]!.documentId;
    const items = (await list()).items;
    expect(items.map((item) => item.fileName).sort()).toEqual(["horno.jpg", "manual-1.pdf"]);
    expect(items.find((item) => item.fileName === "horno.jpg")).toMatchObject({
      kind: "photo",
      status: "checking",
    });
  });

  it("refuses types and sizes the purpose does not accept", async () => {
    for (const file of [
      { fileName: "a.zip", contentType: "application/zip", size: 1000 },
      { fileName: "big.jpg", contentType: "image/jpeg", size: 11 * 1024 * 1024 },
      { fileName: "big.pdf", contentType: "application/pdf", size: 21 * 1024 * 1024 },
    ]) {
      const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, path("/documents"), {
        files: [file],
      });
      expect(response.statusCode, file.fileName).toBe(422);
    }
  });

  it("queues the reading once (FR-040)", async () => {
    const completed = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/documents/${documentId}/complete`),
    );
    expect(completed.statusCode, completed.body).toBe(202);
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pgboss.job WHERE name = 'guide.document' AND data->>'documentId' = $1`,
      [documentId],
    );
    expect(rows[0]?.count).toBe(1);
    const again = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/documents/${documentId}/complete`),
    );
    expect(again.statusCode).toBe(409);
  });

  it("lists suggestions, and accept, edit, or discard them through the item routes (FR-041)", async () => {
    // What the job would leave: a done document and two unreviewed suggestions.
    const view = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, path())
    ).json() as GuideView;
    const appliances = view.sections.find((section) => section.kind === "appliances")!;
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO guide_item (workspace_id, section_id, kind, position, source, source_detail, source_language, document_id)
       VALUES ($1, $2, 'text', 10, 'document', 'manual-1.pdf', 'es', $3),
              ($1, $2, 'text', 11, 'document', 'manual-1.pdf', 'es', $3)
       RETURNING id`,
      [team.workspaceId, appliances.id, documentId],
    );
    for (const row of rows) {
      await db.query(
        `INSERT INTO guide_item_text (item_id, language, workspace_id, doc, text_length, origin, state)
         VALUES ($1, 'es', $2, '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Use el programa corto."}]}]}', 22, 'source', 'current')`,
        [row.id, team.workspaceId],
      );
    }
    await db.query(
      `UPDATE guide_document SET status = 'done', suggestion_count = 2 WHERE id = $1`,
      [documentId],
    );
    const listed = (await list(team.agent)).items.find((item) => item.id === documentId)!;
    expect(listed).toMatchObject({ status: "done" });
    expect(listed.suggestionItemIds.sort()).toEqual(rows.map((row) => row.id).sort());

    const fresh = (
      await wsApi(ctx, team.owner, "GET", team.workspaceId, path())
    ).json() as GuideView;
    const section = fresh.sections.find((candidate) => candidate.id === appliances.id)!;
    const accepted = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      path(`/items/${rows[0]!.id}/approve`),
      { revision: section.revision },
    );
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect((await list()).items.find((item) => item.id === documentId)!.suggestionItemIds).toEqual([
      rows[1]!.id,
    ]);

    // Removing the file removes its unreviewed suggestions; accepted ones stay.
    const removed = await wsApi(
      ctx,
      team.owner,
      "DELETE",
      team.workspaceId,
      path(`/documents/${documentId}`),
    );
    expect(removed.statusCode).toBe(204);
    const { rows: left } = await db.query<{ id: string }>(
      `SELECT id FROM guide_item WHERE id = ANY($1::uuid[])`,
      [rows.map((row) => row.id)],
    );
    expect(left.map((row) => row.id)).toEqual([rows[0]!.id]);
    const after = (await accepted.json()) as SectionWriteResult;
    expect(after.item?.reviewed).toBe(true);
  });

  it("lets agents read the list only (AC-SEC-001)", async () => {
    expect((await list(team.agent)).items.length).toBeGreaterThan(0);
    const created = await wsApi(ctx, team.agent, "POST", team.workspaceId, path("/documents"), {
      files: [pdfFile(9)],
    });
    expect(created.statusCode).toBe(403);
  });
});
