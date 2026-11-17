import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createDb, withRlsContext, type DbHandle } from "@guidesk/db";
import { LocalKeyManagement } from "@guidesk/integrations";
import { createDataKeyStore, Vault } from "@guidesk/vault";
// eslint-disable-next-line no-restricted-imports -- test only: checks the worker can read what the API wrote
import { VaultDecrypter } from "@guidesk/vault/decrypt";
import { REQUEST_DB_HANDLE } from "../../src/database/database.module.js";
import { systemQuery } from "./helpers.js";
import { seedTeam, type TeamWorkspace } from "./property-helpers.js";
import { createTestApp } from "./test-app.js";

/**
 * The vault against PostgreSQL and RLS (research R5, T019): the API creates and uses a
 * workspace's data key in the owner's request context, agents cannot, and the worker's system
 * context decrypts what the API stored.
 */
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let db: ReturnType<typeof systemQuery>;
let requestDb: DbHandle;
let systemDb: DbHandle;
let team: TeamWorkspace;
const kms = new LocalKeyManagement(Buffer.alloc(32, 5));

beforeAll(async () => {
  ctx = await createTestApp(inject("databaseUrl"));
  db = systemQuery(inject("databaseUrl"));
  requestDb = ctx.app.get<DbHandle>(REQUEST_DB_HANDLE);
  systemDb = createDb(inject("databaseUrl"), { max: 1 });
  team = await seedTeam(ctx, db, "vault");
});

afterAll(async () => {
  await systemDb.pool.end();
  await db.close();
  await ctx.app.close();
});

describe("vault data keys under RLS (T019, R5)", () => {
  it("creates one data key on first use, reuses it, and the worker decrypts the value", async () => {
    const vault = new Vault(kms);
    const rowId = randomUUID();
    const aad = {
      workspaceId: team.workspaceId,
      table: "calendar_feed",
      column: "url_ciphertext",
      rowId,
    };
    const first = await withRlsContext(
      requestDb.db,
      { userId: team.owner.userId, workspaceId: team.workspaceId },
      (tx) => vault.encrypt(createDataKeyStore(tx), aad, "https://calendar.example.test/feed.ics"),
    );
    const second = await withRlsContext(
      requestDb.db,
      { userId: team.admin.userId, workspaceId: team.workspaceId },
      (tx) => vault.encrypt(createDataKeyStore(tx), { ...aad, rowId: randomUUID() }, "other"),
    );
    expect(second.dataKeyId).toBe(first.dataKeyId);
    const { rows } = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM workspace_data_key WHERE workspace_id = $1`,
      [team.workspaceId],
    );
    expect(rows[0]?.count).toBe(1);

    const plaintext = await new VaultDecrypter(kms).decryptText(
      createDataKeyStore(systemDb.db),
      { ...aad, dataKeyId: first.dataKeyId },
      first.ciphertext,
    );
    expect(plaintext).toBe("https://calendar.example.test/feed.ics");
  });

  it("does not let agents read or create data keys", async () => {
    const vault = new Vault(kms);
    await expect(
      withRlsContext(
        requestDb.db,
        { userId: team.agent.userId, workspaceId: team.workspaceId },
        (tx) =>
          vault.encrypt(
            createDataKeyStore(tx),
            { workspaceId: team.workspaceId, table: "stay", column: "x", rowId: randomUUID() },
            "secret",
          ),
      ),
    ).rejects.toThrow();
  });
});
