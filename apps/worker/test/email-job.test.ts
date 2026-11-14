import { describe, expect, it } from "vitest";
import type { EmailAdapter, EmailMessage } from "@guidesk/integrations";
import { createEmailHandler } from "../src/jobs/email.js";

describe("email job (T064)", () => {
  const message: EmailMessage = {
    to: "ana@example.com",
    subject: "s",
    html: "<p>h</p>",
    text: "t",
    template: "auth.new_device",
  };

  it("sends every valid queued email", async () => {
    const sent: EmailMessage[] = [];
    const adapter: EmailAdapter = { send: async (m) => (sent.push(m), { messageId: "1" }) };
    await createEmailHandler(adapter)([{ id: "j1", data: message }]);
    expect(sent).toEqual([message]);
  });

  it("drops malformed payloads instead of retrying forever", async () => {
    const adapter: EmailAdapter = { send: async () => ({ messageId: "x" }) };
    await expect(
      createEmailHandler(adapter)([{ id: "j2", data: { to: 1 } }]),
    ).resolves.toBeUndefined();
  });

  it("throws on delivery failure so pg-boss retries", async () => {
    const adapter: EmailAdapter = { send: async () => Promise.reject(new Error("SES down")) };
    await expect(createEmailHandler(adapter)([{ id: "j3", data: message }])).rejects.toThrow(
      "SES down",
    );
  });
});
