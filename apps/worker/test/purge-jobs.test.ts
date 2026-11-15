import { describe, expect, it } from "vitest";
import type { EmailMessage } from "@guidesk/integrations";
import { createPurgeAccountsHandler } from "../src/jobs/purge-accounts.js";
import { createPurgeWorkspacesHandler } from "../src/jobs/purge-workspaces.js";

describe("purge jobs (T094, T095)", () => {
  it("purges due workspaces through the database function", async () => {
    const statements: string[] = [];
    await createPurgeWorkspacesHandler({
      executeSql: async (text) => {
        statements.push(text);
        return { rows: [] };
      },
    })();
    expect(statements).toEqual(["SELECT * FROM purge_due_workspaces()"]);
  });

  it("purges due accounts, notifies the last address, and skips blocked ones", async () => {
    const sent: EmailMessage[] = [];
    const purged: unknown[] = [];
    await createPurgeAccountsHandler(
      {
        executeSql: async (text, values) => {
          if (text.includes("FROM account_deletion_request")) {
            return {
              rows: [
                { user_id: "u1", email: "ana@example.com", preferred_language: "en" },
                { user_id: "u2", email: "bo@example.com", preferred_language: "es" },
              ],
            };
          }
          if (values?.[0] === "u2") {
            throw Object.assign(new Error("owns a shared workspace"), { code: "GD409" });
          }
          purged.push(values?.[0]);
          return { rows: [] };
        },
      },
      { send: async (message) => (sent.push(message), { messageId: "1" }) },
    )();
    expect(purged).toEqual(["u1"]);
    expect(sent.map((m) => [m.to, m.template])).toEqual([["ana@example.com", "account.deleted"]]);
  });
});
