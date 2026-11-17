import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import type { CreatedCsvImport, ImportItemList, ImportRun } from "@guidesk/contracts";
import { systemQuery } from "./helpers.js";
import {
  insertDataKey,
  insertProperty,
  seedTeam,
  wsApi,
  type TeamWorkspace,
} from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * US5: the API's side of CSV import (T105; FR-037 to FR-042, AC-SEC-001, AC-SEC-006): the
 * template, the upload and validation request, confirming within the free slots, cancelling, and
 * the error file. Validation and creation run in the worker and are tested there
 * (apps/worker/test/integration/csv-jobs.test.ts); here the validated rows are seeded the way
 * `csv.validate` leaves them. All data is fictional.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let team: TeamWorkspace;

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  team = await seedTeam(ctx, db, "csv");
});

afterAll(async () => {
  await db.close();
  await ctx.app.close();
});

const FORMULA = '=HYPERLINK("https://evil.example")';

interface SeedRow {
  rowNumber: number;
  valid?: boolean;
  name?: string;
  link?: boolean;
  outcome?: "pending" | "created" | "failed";
  errors?: { column: string; code: string }[];
}

/** A run as `csv.validate` leaves it: valid rows pending, invalid rows failed with their errors. */
async function seedRun(
  workspaceId: string,
  rows: SeedRow[],
  run: { status?: string; finishedDaysAgo?: number; kind?: "csv" | "pms" } = {},
): Promise<string> {
  const invalid = rows.filter((row) => row.valid === false).length;
  const { rows: created } = await db.query<{ id: string }>(
    `INSERT INTO import_run (workspace_id, kind, status, total, processed, failed, started_by, finished_at)
     VALUES ($1, $2, $3, $4, $5, $5, $6,
       CASE WHEN $7::int IS NULL THEN NULL ELSE now() - make_interval(days => $7::int) END)
     RETURNING id`,
    [
      workspaceId,
      run.kind ?? "csv",
      run.status ?? "awaiting_confirmation",
      rows.length,
      invalid,
      team.owner.userId,
      run.finishedDaysAgo ?? null,
    ],
  );
  const runId = created[0]!.id;
  const keyId = await insertDataKey(db, workspaceId);
  for (const row of rows) {
    const valid = row.valid !== false;
    const name = row.name ?? `Casa Prueba ${row.rowNumber}`;
    await db.query(
      `INSERT INTO import_item (workspace_id, import_run_id, row_number, label, selected, outcome,
         reason_code, errors, row_values, calendar_url_ciphertext, data_key_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        workspaceId,
        runId,
        row.rowNumber,
        name.slice(0, 120),
        valid,
        row.outcome ?? (valid ? "pending" : "failed"),
        valid ? null : "invalid_row",
        JSON.stringify(
          row.errors ?? (valid ? [] : [{ column: "country", code: "invalid_country" }]),
        ),
        JSON.stringify({
          name,
          addressLine1: "Calle Ficticia 123",
          city: "Sámara",
          country: valid ? "CR" : "Narnia",
          guideLanguages: "es, en",
        }),
        row.link ? randomBytes(48) : null,
        row.link ? keyId : null,
      ],
    );
  }
  return runId;
}

const rowsFrom = (count: number, overrides: (n: number) => Partial<SeedRow> = () => ({})) =>
  Array.from({ length: count }, (_, i) => ({ rowNumber: i + 2, ...overrides(i + 2) }));

async function freshTeam(prefix: string, propertyLimit: number | null) {
  const fresh = await seedTeam(ctx, db, prefix);
  await db.query(`UPDATE workspace SET property_limit = $2 WHERE id = $1`, [
    fresh.workspaceId,
    propertyLimit,
  ]);
  return fresh;
}

async function queued(queue: string, importRunId: string) {
  const { rows } = await db.query(
    `SELECT 1 FROM pgboss.job WHERE name = $1 AND data->>'importRunId' = $2`,
    [queue, importRunId],
  );
  return rows.length;
}

async function itemsOf(runId: string) {
  const { rows } = await db.query<{
    row_number: number;
    outcome: string;
    reason_code: string | null;
    selected: boolean;
    has_link: boolean;
  }>(
    `SELECT row_number, outcome, reason_code, selected,
            calendar_url_ciphertext IS NOT NULL AS has_link
       FROM import_item WHERE import_run_id = $1 ORDER BY row_number`,
    [runId],
  );
  return rows;
}

async function countEvents(type: string, workspaceId: string) {
  const { rows } = await db.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM security_event WHERE type = $1 AND workspace_id = $2`,
    [type, workspaceId],
  );
  return rows[0]!.count;
}

describe("the template (FR-037, US5 scenario 1)", () => {
  it("is in Spanish with semicolons, instructions, and one example row", async () => {
    const response = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      "/imports/csv-template?lang=es",
    );
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="[\w-]+\.csv"$/);
    expect(response.headers["cache-control"]).toBe("no-store");
    const body = response.body;
    expect(body.startsWith("\ufeff")).toBe(true);
    const lines = body.slice(1).split("\r\n");
    expect(lines.filter((line) => /^"?# /.test(line)).length).toBeGreaterThanOrEqual(4);
    expect(lines).toContain(
      [
        "Nombre",
        "Calle y número",
        "Unidad",
        "Ciudad",
        "Provincia o región",
        "Código postal",
        "País",
        "Zona horaria",
        "Hora de entrada",
        "Hora de salida",
        "Máximo de huéspedes",
        "Idiomas de la guía",
        "Enlace del calendario (iCal)",
      ].join(";"),
    );
    expect(lines.some((line) => line.startsWith("# Casa Colibrí (ejemplo);"))).toBe(true);
  });

  it("is in English with commas", async () => {
    const response = await wsApi(
      ctx,
      team.admin,
      "GET",
      team.workspaceId,
      "/imports/csv-template?lang=en",
    );
    expect(response.statusCode).toBe(200);
    const lines = response.body.slice(1).split("\r\n");
    expect(lines).toContain(
      [
        "Name",
        "Street and number",
        "Unit",
        "City",
        "State or region",
        "Postal code",
        "Country",
        "Time zone",
        "Check-in time",
        "Checkout time",
        "Maximum guests",
        "Guide languages",
        "Calendar link (iCal)",
      ].join(","),
    );
    expect(response.body).toMatch(/Never type door codes/);
  });

  it("refuses an unknown language", async () => {
    const response = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      "/imports/csv-template?lang=fr",
    );
    expect(response.statusCode).toBe(422);
  });
});

describe("uploading and validating a file (FR-038, FR-039)", () => {
  it("creates a run and an upload form for a file up to 2 MB", async () => {
    const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/imports/csv", {
      contentType: "text/csv",
      size: 4096,
    });
    expect(response.statusCode, response.body).toBe(201);
    const created = response.json() as CreatedCsvImport;
    expect(created.upload.url).toMatch(/^http/);
    const { rows } = await db.query<{ status: string; kind: string; purpose: string }>(
      `SELECT r.status, r.kind, u.purpose FROM import_run r JOIN upload u ON u.id = r.upload_id
        WHERE r.id = $1 AND u.import_run_id = r.id`,
      [created.importRunId],
    );
    expect(rows).toEqual([{ status: "validating", kind: "csv", purpose: "csv" }]);

    const run = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/imports/${created.importRunId}`,
    );
    expect(run.json()).toMatchObject({ kind: "csv", status: "validating", errorCode: null });
  });

  it("refuses a file over 2 MB or of another type", async () => {
    for (const body of [
      { contentType: "text/csv", size: 2 * 1024 * 1024 + 1 },
      { contentType: "image/png", size: 1000 },
    ]) {
      const response = await wsApi(ctx, team.owner, "POST", team.workspaceId, "/imports/csv", body);
      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({ code: "validation_failed" });
    }
  });

  it("queues the validation once the upload is done, and only once", async () => {
    const created = (
      await wsApi(ctx, team.owner, "POST", team.workspaceId, "/imports/csv", {
        contentType: "application/vnd.ms-excel",
        size: 900,
      })
    ).json() as CreatedCsvImport;
    const path = `/imports/${created.importRunId}/validate`;
    const first = await wsApi(ctx, team.owner, "POST", team.workspaceId, path);
    expect(first.statusCode).toBe(202);
    expect(await queued("csv.validate", created.importRunId)).toBe(1);
    const again = await wsApi(ctx, team.owner, "POST", team.workspaceId, path);
    expect(again.statusCode).toBe(409);
    expect(await queued("csv.validate", created.importRunId)).toBe(1);
  });

  it("lists each row's errors and warnings by column", async () => {
    const runId = await seedRun(team.workspaceId, [
      { rowNumber: 2 },
      { rowNumber: 7, valid: false, errors: [{ column: "timeZone", code: "invalid_time_zone" }] },
    ]);
    const response = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/imports/${runId}/items`,
    );
    const { items } = response.json() as ImportItemList;
    expect(items.map((item) => [item.rowNumber, item.selected, item.outcome, item.errors])).toEqual(
      [
        [2, true, "pending", []],
        [7, false, "failed", [{ column: "timeZone", code: "invalid_time_zone" }]],
      ],
    );
  });
});

describe("confirming the valid rows (FR-040, US5 scenarios 3 and 5)", () => {
  it("creates every valid row when they fit, in the background", async () => {
    const roomy = await freshTeam("csv-roomy", 30);
    const runId = await seedRun(
      roomy.workspaceId,
      rowsFrom(25, (n) => ({ valid: n !== 7 && n !== 19, link: n === 3 })),
    );
    const before = await countEvents("import.started", roomy.workspaceId);
    const response = await wsApi(
      ctx,
      roomy.owner,
      "POST",
      roomy.workspaceId,
      `/imports/${runId}/confirm`,
      {},
    );
    expect(response.statusCode, response.body).toBe(202);
    expect(response.json()).toMatchObject({ status: "running", total: 25, failed: 2 });
    expect(await queued("csv.import", runId)).toBe(1);
    const items = await itemsOf(runId);
    expect(items.filter((item) => item.outcome === "pending" && item.selected)).toHaveLength(23);
    // The link waits, encrypted, until the property exists (FR-042).
    expect(items.find((item) => item.row_number === 3)!.has_link).toBe(true);
    expect(await countEvents("import.started", roomy.workspaceId)).toBe(before + 1);

    const again = await wsApi(
      ctx,
      roomy.owner,
      "POST",
      roomy.workspaceId,
      `/imports/${runId}/confirm`,
      {},
    );
    expect(again.statusCode).toBe(409);
  });

  it("asks which rows to create when they are more than the free slots", async () => {
    const tight = await freshTeam("csv-tight", 3);
    await insertProperty(db, tight.workspaceId);
    const runId = await seedRun(
      tight.workspaceId,
      rowsFrom(5, (n) => ({ valid: n !== 4, link: true })),
    );
    const path = `/imports/${runId}/confirm`;

    const all = await wsApi(ctx, tight.owner, "POST", tight.workspaceId, path, {});
    expect(all.statusCode).toBe(422);
    expect(all.json()).toMatchObject({
      code: "validation_failed",
      fields: { rowNumbers: [expect.any(String)] },
      free: 2,
      limit: 3,
    });
    for (const rowNumbers of [
      [2, 3, 5],
      [2, 4],
      [2, 99],
    ]) {
      const refused = await wsApi(ctx, tight.owner, "POST", tight.workspaceId, path, {
        rowNumbers,
      });
      expect(refused.statusCode, JSON.stringify(rowNumbers)).toBe(422);
    }

    const chosen = await wsApi(ctx, tight.owner, "POST", tight.workspaceId, path, {
      rowNumbers: [3, 6],
    });
    expect(chosen.statusCode, chosen.body).toBe(202);
    expect(await itemsOf(runId)).toEqual([
      {
        row_number: 2,
        outcome: "skipped",
        reason_code: "not_selected",
        selected: false,
        has_link: false,
      },
      { row_number: 3, outcome: "pending", reason_code: null, selected: true, has_link: true },
      {
        row_number: 4,
        outcome: "failed",
        reason_code: "invalid_row",
        selected: false,
        has_link: false,
      },
      {
        row_number: 5,
        outcome: "skipped",
        reason_code: "not_selected",
        selected: false,
        has_link: false,
      },
      { row_number: 6, outcome: "pending", reason_code: null, selected: true, has_link: true },
    ]);
    const run = (
      await wsApi(ctx, tight.owner, "GET", tight.workspaceId, `/imports/${runId}`)
    ).json() as ImportRun;
    expect(run).toMatchObject({ status: "running", total: 5, processed: 3, failed: 1, skipped: 2 });
  });

  it("refuses when no slot is free", async () => {
    const full = await freshTeam("csv-full", 1);
    await insertProperty(db, full.workspaceId);
    const runId = await seedRun(full.workspaceId, rowsFrom(2));
    const response = await wsApi(
      ctx,
      full.owner,
      "POST",
      full.workspaceId,
      `/imports/${runId}/confirm`,
      {},
    );
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ code: "plan_limit_reached", limit: 1 });
  });

  it("refuses a file with no valid row", async () => {
    const runId = await seedRun(
      team.workspaceId,
      rowsFrom(2, () => ({ valid: false })),
    );
    const response = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/imports/${runId}/confirm`,
      {},
    );
    expect(response.statusCode).toBe(409);
  });
});

describe("cancelling (FR-040, data model §6)", () => {
  it("clears every calendar link of the run's rows", async () => {
    const runId = await seedRun(
      team.workspaceId,
      rowsFrom(4, (n) => ({ link: true, valid: n !== 3 })),
    );
    const response = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/imports/${runId}/cancel`,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({ status: "cancelled", finishedAt: expect.any(String) });
    const { rows } = await db.query(
      `SELECT 1 FROM import_item WHERE import_run_id = $1
         AND (calendar_url_ciphertext IS NOT NULL OR data_key_id IS NOT NULL)`,
      [runId],
    );
    expect(rows).toEqual([]);
    const again = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/imports/${runId}/cancel`,
    );
    expect(again.statusCode).toBe(409);
  });

  it("cannot cancel a run that is creating properties", async () => {
    const runId = await seedRun(team.workspaceId, rowsFrom(2), { status: "running" });
    const response = await wsApi(
      ctx,
      team.owner,
      "POST",
      team.workspaceId,
      `/imports/${runId}/cancel`,
    );
    expect(response.statusCode).toBe(409);
  });
});

describe("the error file (FR-039, FR-041, FR-042, AC-SEC-006)", () => {
  it("lists rows with errors in Spanish, with formula cells neutralized and no calendar links", async () => {
    const runId = await seedRun(
      team.workspaceId,
      [
        { rowNumber: 2 },
        { rowNumber: 3, valid: false, name: FORMULA, link: false },
        {
          rowNumber: 4,
          outcome: "created",
          link: false,
          errors: [{ column: "calendarUrl", code: "calendar_rejected" }],
        },
      ],
      { status: "completed", finishedDaysAgo: 1 },
    );
    const response = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/imports/${runId}/error-file?lang=es`,
    );
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="[\w-]+\.csv"$/);
    const lines = response.body.slice(1).split("\r\n").filter(Boolean);
    const header = lines.find((line) => line.startsWith("Fila;Errores;Nombre;"))!;
    expect(header).toBeDefined();
    const data = lines.slice(lines.indexOf(header) + 1);
    expect(data).toHaveLength(2);
    expect(data[0]).toContain(`"'=HYPERLINK(""https://evil.example"")"`);
    expect(data[0]).toContain("País: país no reconocido");
    expect(data[1]).toMatch(/^4;Enlace del calendario \(iCal\): /);
    // The calendar link column is the last one, and always empty.
    for (const line of data) expect(line.endsWith(";")).toBe(true);
    expect(response.body).not.toMatch(/(^|[;\n])=HYPERLINK/);
  });

  it("is in English on request, and available while the host decides", async () => {
    const runId = await seedRun(team.workspaceId, [{ rowNumber: 5, valid: false }]);
    const response = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/imports/${runId}/error-file?lang=en`,
    );
    expect(response.statusCode).toBe(200);
    expect(response.body).toContain("Row,Errors,Name,");
    expect(response.body).toContain("Country: country not recognized");
  });

  it("is gone 7 days after the run finished", async () => {
    const runId = await seedRun(team.workspaceId, [{ rowNumber: 2, valid: false }], {
      status: "completed",
      finishedDaysAgo: 8,
    });
    const response = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/imports/${runId}/error-file`,
    );
    expect(response.statusCode).toBe(410);
  });

  it("exists only for CSV runs", async () => {
    const runId = await seedRun(team.workspaceId, [], {
      kind: "pms",
      status: "completed",
      finishedDaysAgo: 0,
    });
    const response = await wsApi(
      ctx,
      team.owner,
      "GET",
      team.workspaceId,
      `/imports/${runId}/error-file`,
    );
    expect(response.statusCode).toBe(404);
  });
});

describe("roles (AC-SEC-001)", () => {
  it("refuses agents with 404 and logs each refusal", async () => {
    const runId = await seedRun(team.workspaceId, rowsFrom(2));
    const before = await countEvents("access.role_denied", team.workspaceId);
    const attempts = [
      wsApi(ctx, team.agent, "GET", team.workspaceId, "/imports/csv-template?lang=es"),
      wsApi(ctx, team.agent, "POST", team.workspaceId, "/imports/csv", {
        contentType: "text/csv",
        size: 10,
      }),
      wsApi(ctx, team.agent, "POST", team.workspaceId, `/imports/${runId}/validate`),
      wsApi(ctx, team.agent, "POST", team.workspaceId, `/imports/${runId}/confirm`, {}),
      wsApi(ctx, team.agent, "POST", team.workspaceId, `/imports/${runId}/cancel`),
      wsApi(ctx, team.agent, "GET", team.workspaceId, `/imports/${runId}/error-file`),
    ];
    for (const response of await Promise.all(attempts)) expect(response.statusCode).toBe(404);
    expect(await countEvents("access.role_denied", team.workspaceId)).toBe(
      before + attempts.length,
    );
    expect((await itemsOf(runId)).every((item) => item.outcome === "pending")).toBe(true);
  });

  it("keeps other workspaces' runs out of reach", async () => {
    const other = await freshTeam("csv-other", null);
    const runId = await seedRun(
      other.workspaceId,
      rowsFrom(1, () => ({ link: true })),
    );
    for (const [method, path] of [
      ["POST", `/imports/${runId}/confirm`],
      ["POST", `/imports/${runId}/cancel`],
      ["GET", `/imports/${runId}/error-file`],
    ] as const) {
      const response = await wsApi(
        ctx,
        team.owner,
        method,
        team.workspaceId,
        path,
        method === "POST" ? {} : undefined,
      );
      expect(response.statusCode).toBe(404);
    }
    expect((await itemsOf(runId))[0]!.has_link).toBe(true);
  });
});
