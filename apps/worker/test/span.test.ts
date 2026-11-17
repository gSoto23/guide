import type { Attributes, Span, SpanOptions, Tracer } from "@opentelemetry/api";
import { describe, expect, it } from "vitest";
import { runInJobSpan, safeAttributes } from "../src/jobs/span.js";

/** Records span attributes and status; enough of the Tracer API for runInJobSpan. */
function fakeTracer() {
  const spans: { name: string; attributes: Attributes; status?: number; ended: boolean }[] = [];
  const tracer = {
    startActiveSpan: (name: string, options: SpanOptions, fn: (span: Span) => unknown) => {
      const record = { name, attributes: { ...options.attributes }, ended: false } as {
        name: string;
        attributes: Attributes;
        status?: number;
        ended: boolean;
      };
      spans.push(record);
      const span = {
        setAttributes: (attributes: Attributes) => Object.assign(record.attributes, attributes),
        setStatus: (status: { code: number }) => {
          record.status = status.code;
        },
        end: () => {
          record.ended = true;
        },
      } as unknown as Span;
      return fn(span);
    },
  } as unknown as Tracer;
  return { tracer, spans };
}

function fakeCounter() {
  const added: Attributes[] = [];
  return {
    counter: { add: (_n: number, attributes?: Attributes) => added.push({ ...attributes }) },
    added,
  };
}

const FEED_LINK = "https://calendar.example.test/ical/secret-token.ics";

describe("job spans (T030, constitution VIII)", () => {
  it("keeps only allowed keys with short plain values", () => {
    expect(
      safeAttributes({
        "workspace.id": "6f1c2a7e-0d4b-4c39-9a51-2b7f1e0c9d11",
        "job.created": 3,
        "feed.url": FEED_LINK,
        guestName: "Ana Ficticia",
        credential: "token-123",
        "error.code": "has spaces and a code 4821",
      }),
    ).toEqual({ "workspace.id": "6f1c2a7e-0d4b-4c39-9a51-2b7f1e0c9d11", "job.created": 3 });
  });

  it("wraps a job in a span with the queue, workspace, and counts", async () => {
    const { tracer, spans } = fakeTracer();
    const { counter } = fakeCounter();
    const result = await runInJobSpan(
      { queue: "pms.import", workspaceId: "ws-1", attributes: { credential: "secret" } },
      async (span) => {
        span.set({ "job.created": 12, "job.failed": 1, guestName: "Ana Ficticia" });
        return "done";
      },
      { tracer, failures: counter },
    );
    expect(result).toBe("done");
    expect(spans[0]).toMatchObject({
      name: "job pms.import",
      attributes: {
        "job.queue": "pms.import",
        "workspace.id": "ws-1",
        "job.created": 12,
        "job.failed": 1,
      },
      ended: true,
    });
    expect(JSON.stringify(spans)).not.toMatch(/secret|Ana/);
  });

  it("counts failures per provider and error code", async () => {
    const { tracer } = fakeTracer();
    const { counter, added } = fakeCounter();
    await runInJobSpan(
      { queue: "pms.refresh" },
      async (span) => span.recordFailure("rate_limited", "beds24"),
      { tracer, failures: counter },
    );
    expect(added).toEqual([
      { "job.queue": "pms.refresh", "error.code": "rate_limited", "pms.provider": "beds24" },
    ]);
  });

  it("marks a thrown job as failed without recording the error's message", async () => {
    const { tracer, spans } = fakeTracer();
    const { counter, added } = fakeCounter();
    await expect(
      runInJobSpan(
        { queue: "calendar.refresh" },
        async () => {
          throw new Error(`could not read ${FEED_LINK}`);
        },
        { tracer, failures: counter },
      ),
    ).rejects.toThrow();
    expect(spans[0]?.status).toBe(2);
    expect(spans[0]?.ended).toBe(true);
    expect(added).toEqual([{ "job.queue": "calendar.refresh", "error.code": "internal" }]);
    expect(JSON.stringify(spans)).not.toContain("secret-token");
  });
});
