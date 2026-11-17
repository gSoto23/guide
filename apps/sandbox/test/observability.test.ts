import * as Sentry from "@sentry/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  initSandboxSentry,
  instrumentHandler,
  logInvocation,
  sandboxBeforeSend,
} from "../src/observability.js";

const FEED_LINK = "https://calendar.example.test/ical/a1b2c3-secret-token.ics";
const RECOGNIZED_TEXT = "Door code 4821 — Wi-Fi password: Colibri2026";

/** Every Sentry envelope body the test transport receives. */
const sent: string[] = [];

beforeAll(() => {
  initSandboxSentry("feed-reader", {
    dsn: "https://public@o0.ingest.sentry.io/0",
    transport: (options) =>
      Sentry.createTransport(options, async (request) => {
        sent.push(
          typeof request.body === "string" ? request.body : new TextDecoder().decode(request.body),
        );
        return { statusCode: 200 };
      }),
  });
});

afterAll(async () => {
  await Sentry.close(1000);
});

describe("sandbox observability (T002, constitution VIII)", () => {
  it("logs only the function, request ID, outcome, and duration", () => {
    const lines: string[] = [];
    logInvocation(
      { fn: "file-processor", requestId: "req-1", outcome: "unsupported_type", durationMs: 12.6 },
      (text) => lines.push(text),
    );
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      level: "warn",
      fn: "file-processor",
      requestId: "req-1",
      outcome: "unsupported_type",
      durationMs: 13,
    });
  });

  it("never logs an outcome that is not a short code", () => {
    const lines: string[] = [];
    logInvocation(
      { fn: "feed-reader", requestId: "req-2", outcome: FEED_LINK, durationMs: 1 },
      (text) => lines.push(text),
    );
    expect(lines.join("")).not.toContain("secret-token");
  });

  it("keeps a feed link and recognized text out of the log line and the Sentry event when a handler throws", async () => {
    const lines: string[] = [];
    const handler = instrumentHandler(
      "feed-reader",
      async (input: { url: string }) => {
        throw new Error(`cannot read ${input.url}: ${RECOGNIZED_TEXT}`);
      },
      { write: (text) => lines.push(text) },
    );

    const result = await handler({ url: FEED_LINK }, { awsRequestId: "req-3" });

    expect(result).toEqual({ error: "internal" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ requestId: "req-3", outcome: "internal" });
    await Sentry.flush(2000);
    expect(sent.length).toBeGreaterThan(0);
    for (const text of [...lines, ...sent]) {
      expect(text).not.toContain("secret-token");
      expect(text).not.toContain("calendar.example.test");
      expect(text).not.toContain("4821");
      expect(text).not.toContain("Colibri2026");
    }
  });

  it("logs the error code a handler returns as the outcome", async () => {
    const lines: string[] = [];
    const handler = instrumentHandler("feed-reader", async () => ({ error: "not_ical" as const }), {
      write: (text) => lines.push(text),
    });
    await handler({}, { awsRequestId: "req-4" });
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ outcome: "not_ical" });
  });

  it("removes messages, breadcrumbs, local variables, and request contexts from events", () => {
    const event = sandboxBeforeSend({
      type: undefined,
      message: FEED_LINK,
      exception: {
        values: [
          {
            type: "Error",
            value: RECOGNIZED_TEXT,
            stacktrace: { frames: [{ function: "read", vars: { url: FEED_LINK } }] },
          },
        ],
      },
      breadcrumbs: [{ category: "http", message: FEED_LINK }],
      contexts: { runtime: { name: "node" }, state: { url: FEED_LINK } },
      extra: { text: RECOGNIZED_TEXT },
    });
    const text = JSON.stringify(event);
    expect(text).not.toContain("secret-token");
    expect(text).not.toContain("4821");
    expect(event.exception?.values?.[0]?.type).toBe("Error");
    expect(event.contexts).toEqual({ runtime: { name: "node" } });
  });
});
