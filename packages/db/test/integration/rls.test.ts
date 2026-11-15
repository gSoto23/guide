import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { sql } from "drizzle-orm";
import { createDb, withRlsContext, type DbHandle } from "../../src/index.js";

let handle: DbHandle;

beforeAll(() => {
  handle = createDb(inject("databaseUrl"), { max: 2 });
});

afterAll(async () => {
  await handle.pool.end();
});

/** Drizzle wraps driver errors; the PostgreSQL message is on `cause`. */
async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e as { message?: string; cause?: { message?: string } },
  );
  expect(error, "expected the query to fail").toBeDefined();
  expect(`${error?.message ?? ""} ${error?.cause?.message ?? ""}`).toMatch(pattern);
}

async function scalar<T>(query: ReturnType<typeof sql>): Promise<T> {
  const result = await handle.db.execute(query);
  return Object.values(result.rows[0] ?? {})[0] as T;
}

describe("withRlsContext (T014)", () => {
  it("runs the callback as guidesk_app with the request context", async () => {
    const workspaceId = "0190f5a0-0000-7000-8000-000000000001";
    const row = await withRlsContext(handle.db, { userId: "user-1", workspaceId }, async (tx) => {
      const result = await tx.execute(
        sql`SELECT current_user AS role, app_current_user_id() AS user_id, app_current_workspace_id()::text AS workspace_id`,
      );
      return result.rows[0];
    });
    expect(row).toEqual({ role: "guidesk_app", user_id: "user-1", workspace_id: workspaceId });
  });

  it("does not leak the context or role outside the transaction", async () => {
    await withRlsContext(handle.db, { userId: "user-2" }, async () => undefined);
    expect(await scalar<string | null>(sql`SELECT app_current_user_id()`)).toBeNull();
    expect(await scalar<string>(sql`SELECT current_user`)).not.toBe("guidesk_app");
  });

  it("rejects a workspaceId that is not a UUID", async () => {
    await expect(
      withRlsContext(handle.db, { userId: "user-3", workspaceId: "1 OR 1=1" }, async () => 1),
    ).rejects.toThrow("UUID");
  });

  it("denies guidesk_app access to identity secrets (0003_auth_grants)", async () => {
    await expectDbError(
      withRlsContext(handle.db, { userId: "user-4" }, (tx) =>
        tx.execute(sql`SELECT count(*) FROM "account"`),
      ),
      /permission denied/,
    );
  });
});

describe("security_event (T022, SEC-16)", () => {
  it("accepts inserts and rejects updates and deletes, even for the owner", async () => {
    await handle.db.execute(
      sql`INSERT INTO security_event (type, outcome, actor_user_id) VALUES ('signin.succeeded', 'success', 'user-5')`,
    );
    await expectDbError(
      handle.db.execute(
        sql`UPDATE security_event SET outcome = 'failure' WHERE actor_user_id = 'user-5'`,
      ),
      /append-only/,
    );
    await expectDbError(
      handle.db.execute(sql`DELETE FROM security_event WHERE actor_user_id = 'user-5'`),
      /append-only/,
    );
  });

  it("allows pseudonymization only to a blank or deleted: actor, never re-attribution (T103)", async () => {
    await handle.db.execute(
      sql`INSERT INTO security_event (type, outcome, actor_user_id) VALUES ('signin.succeeded', 'success', 'user-8')`,
    );
    const pseudonymize = (to: string) =>
      handle.db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.security_event_pseudonymize', 'on', true)`);
        await tx.execute(
          sql`UPDATE security_event SET actor_user_id = ${to} WHERE actor_user_id = 'user-8'`,
        );
      });
    await expectDbError(pseudonymize("victim-user"), /append-only/);
    await pseudonymize("deleted:8f1c");
    expect(
      await scalar<number>(
        sql`SELECT count(*)::int FROM security_event WHERE actor_user_id = 'deleted:8f1c'`,
      ),
    ).toBe(1);
  });

  it("keeps request transactions out of partitions and from writing events (T103)", async () => {
    await expectDbError(
      withRlsContext(handle.db, { userId: "user-9" }, (tx) =>
        tx.execute(sql`SELECT count(*) FROM security_event_default`),
      ),
      /permission denied/,
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: "user-9" }, (tx) =>
        tx.execute(
          sql`INSERT INTO security_event (type, outcome, workspace_id) VALUES ('member.removed', 'success', gen_random_uuid())`,
        ),
      ),
      /permission denied/,
    );
    await expectDbError(
      withRlsContext(handle.db, { userId: "user-9" }, (tx) =>
        tx.execute(sql`DELETE FROM rate_limit_bucket`),
      ),
      /permission denied/,
    );
  });

  it("lets a user read only their own account-level events", async () => {
    await handle.db.execute(
      sql`INSERT INTO security_event (type, outcome, actor_user_id) VALUES ('signin.succeeded', 'success', 'user-6'), ('signin.succeeded', 'success', 'user-7')`,
    );
    const visible = await withRlsContext(handle.db, { userId: "user-6" }, async (tx) => {
      const result = await tx.execute(sql`SELECT actor_user_id FROM security_event`);
      return result.rows.map((row) => row.actor_user_id);
    });
    expect(visible).toEqual(["user-6"]);
  });
});
