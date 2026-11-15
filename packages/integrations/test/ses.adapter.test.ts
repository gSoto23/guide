import { describe, expect, it } from "vitest";
import type { SESv2Client } from "@aws-sdk/client-sesv2";
import { SesEmailAdapter } from "../src/index.js";

describe("SesEmailAdapter (contract)", () => {
  it("sends a simple UTF-8 email with the configuration set and a template tag", async () => {
    const sent: unknown[] = [];
    const client = {
      send: async (command: { input: unknown }) => {
        sent.push(command.input);
        return { MessageId: "msg-1" };
      },
    } as unknown as SESv2Client;
    const adapter = new SesEmailAdapter({
      from: "no-reply@example.com",
      configurationSetName: "guidesk-transactional",
      client,
    });

    const result = await adapter.send({
      to: "ana@example.com",
      subject: "Tu código",
      html: "<p>123456</p>",
      text: "123456",
      template: "auth.signin_code",
    });

    expect(result).toEqual({ messageId: "msg-1" });
    expect(sent[0]).toMatchObject({
      FromEmailAddress: "no-reply@example.com",
      Destination: { ToAddresses: ["ana@example.com"] },
      ConfigurationSetName: "guidesk-transactional",
      EmailTags: [{ Name: "template", Value: "auth_signin_code" }],
      Content: { Simple: { Subject: { Data: "Tu código", Charset: "UTF-8" } } },
    });
  });

  it("fails when SES returns no MessageId", async () => {
    const client = { send: async () => ({}) } as unknown as SESv2Client;
    const adapter = new SesEmailAdapter({ from: "a@example.com", client });
    await expect(
      adapter.send({ to: "b@example.com", subject: "s", html: "h", text: "t", template: "x" }),
    ).rejects.toThrow("MessageId");
  });
});
