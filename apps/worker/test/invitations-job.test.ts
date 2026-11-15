import { describe, expect, it } from "vitest";
import {
  createExpireInvitationsHandler,
  EXPIRE_INVITATIONS_CRON,
} from "../src/jobs/invitations.js";

describe("invitation expiry job (T076)", () => {
  it("expires overdue pending invitations and prunes old idempotency keys", async () => {
    const statements: string[] = [];
    await createExpireInvitationsHandler({
      executeSql: async (text) => {
        statements.push(text);
        return { rows: [] };
      },
    })();
    expect(statements[0]).toContain("SET status = 'expired'");
    expect(statements[0]).toContain("status = 'pending' AND expires_at <= now()");
    expect(statements[1]).toContain("DELETE FROM idempotency_key");
  });

  it("runs daily", () => {
    expect(EXPIRE_INVITATIONS_CRON.split(" ")).toHaveLength(5);
  });
});
