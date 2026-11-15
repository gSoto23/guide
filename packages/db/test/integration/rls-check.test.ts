import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import pg from "pg";
import { findTablesWithoutForcedRls } from "../../src/index.js";

describe("findTablesWithoutForcedRls (T015, T103)", () => {
  let client: pg.Client;

  beforeAll(async () => {
    client = new pg.Client({ connectionString: inject("databaseUrl") });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it("finds no offending table after all migrations", async () => {
    expect(await findTablesWithoutForcedRls(inject("databaseUrl"))).toEqual([]);
  });

  it("flags a table guidesk_app can read without forced RLS, including partitions", async () => {
    await client.query("BEGIN");
    try {
      await client.query("CREATE TABLE lint_probe (id int)");
      await client.query("GRANT SELECT ON lint_probe TO guidesk_app");
      await client.query(
        "CREATE TABLE lint_probe_parted (id int, at date) PARTITION BY RANGE (at)",
      );
      await client.query(
        "CREATE TABLE lint_probe_parted_default PARTITION OF lint_probe_parted DEFAULT",
      );
      await client.query("ALTER TABLE lint_probe_parted ENABLE ROW LEVEL SECURITY");
      await client.query("ALTER TABLE lint_probe_parted FORCE ROW LEVEL SECURITY");
      await client.query("GRANT SELECT ON lint_probe_parted_default TO guidesk_app");
      await client.query("COMMIT");
      expect(await findTablesWithoutForcedRls(inject("databaseUrl"))).toEqual([
        "lint_probe",
        "lint_probe_parted_default",
      ]);
    } finally {
      await client.query("ROLLBACK").catch(() => undefined);
      await client.query("DROP TABLE IF EXISTS lint_probe, lint_probe_parted");
    }
  });
});
