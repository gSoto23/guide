import { createECDH, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateVAPIDKeys } from "web-push";
import { loadIntegrationSettings } from "../src/settings.js";
import { WebPushAdapter } from "../src/push/web-push.adapter.js";

/**
 * Web push through the standard protocol (feature 006 T007, research R7): an encrypted request with
 * VAPID, TTL, and urgency; gone subscriptions; failures. The push service is a fake `fetch`; the keys
 * are generated per run.
 */
function subscription() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint: "https://push.example.test/send/abc123",
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  };
}

function service(status: number) {
  const requests: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init: init ?? {} });
    return new Response(null, { status });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

const keys = { ...generateVAPIDKeys(), subject: "https://app.guidesk.test" };
const message = {
  title: "Casa Colibrí",
  body: "Possible emergency",
  url: "/es/properties/p1/conversations/c1",
  tag: "conversation-c1",
  urgency: "high" as const,
};

describe("WebPushAdapter (T007)", () => {
  it("sends an encrypted payload with VAPID, a day's TTL, and the urgency", async () => {
    const { requests, fetchImpl } = service(201);
    const adapter = new WebPushAdapter(keys, fetchImpl);
    expect(adapter.publicKey).toBe(keys.publicKey);
    expect(await adapter.send(subscription(), message)).toBe("sent");
    const [request] = requests;
    expect(request!.url).toBe("https://push.example.test/send/abc123");
    const headers = request!.init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.TTL).toBe("86400");
    expect(headers.Urgency).toBe("high");
    expect(headers.Authorization).toMatch(/^vapid t=.+, k=/);
    const body = Buffer.from(request!.init.body as Uint8Array);
    expect(body.length).toBeGreaterThan(0);
    expect(body.toString("utf8")).not.toContain("Casa Colibrí");
    expect(body.toString("utf8")).not.toContain("emergency");
  });

  it("reports gone subscriptions and failures", async () => {
    for (const [status, outcome] of [
      [404, "gone"],
      [410, "gone"],
      [500, "failed"],
      [429, "failed"],
    ] as const) {
      const { fetchImpl } = service(status);
      expect(await new WebPushAdapter(keys, fetchImpl).send(subscription(), message)).toBe(outcome);
    }
    const broken = { ...subscription(), p256dh: "not-a-key" };
    expect(await new WebPushAdapter(keys, service(201).fetchImpl).send(broken, message)).toBe(
      "gone",
    );
    const offline = (async () => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await new WebPushAdapter(keys, offline).send(subscription(), message)).toBe("failed");
  });

  it("turns push on only with all three VAPID settings", () => {
    const base = {
      FEED_URL_PEPPER: "p".repeat(32),
      LOCAL_KMS_KEY: randomBytes(32).toString("base64"),
    };
    expect(loadIntegrationSettings(base, { production: false }).push).toBeNull();
    expect(
      loadIntegrationSettings(
        {
          ...base,
          VAPID_PUBLIC_KEY: keys.publicKey,
          VAPID_PRIVATE_KEY: keys.privateKey,
          VAPID_SUBJECT: "https://app.guidesk.test",
        },
        { production: false },
      ).push,
    ).toMatchObject({ publicKey: keys.publicKey });
    expect(() =>
      loadIntegrationSettings({ ...base, VAPID_PUBLIC_KEY: keys.publicKey }, { production: false }),
    ).toThrow(/set together/);
  });
});
