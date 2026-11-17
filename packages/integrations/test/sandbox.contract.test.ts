import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { SpanStatusCode, type Span, type SpanStatus, type Tracer } from "@opentelemetry/api";
import type { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  FEED_MAX_ENTRIES,
  FILE_MAX_ROWS,
  FILE_MAX_TEXT_LENGTH,
  InProcessSandbox,
  LambdaSandbox,
  feedReadRequestSchema,
  feedReadResponseSchema,
  fileProcessRequestSchema,
  fileProcessResponseSchema,
  type FeedReadRequest,
  type FeedReadResponse,
  type FileProcessRequest,
  type FileProcessResponse,
  type LambdaInvokeClient,
  type SandboxPort,
} from "../src/index.js";

// Synthetic values that stand for restricted or confidential data: none may reach a span or a log.
const FEED_URL = "https://calendar.example.com/ical/secret-token-a1b2c3.ics";
const ETAG = '"etag-7f3a"';
const LAST_MODIFIED = "Sun, 15 Nov 2026 10:00:00 GMT";
const WORKSPACE_ID = "0b6f2b2e-6f1d-4c55-9a8e-2f4f1c9d7a10";
const UPLOAD_ID = "5d2c8a41-93e7-4b0f-8c1a-7e6d5b4a3f21";
const OBJECT_KEY = `uploads/${WORKSPACE_ID}/${UPLOAD_ID}`;
const SECRET_TEXT = "Check-in 15:00. Door code 4821, Wi-Fi password sunshine99";
const SECRET_ROWS = [
  ["name", "address", "ical_url"],
  ["Casa Azul", "Calle 5, San José", "https://private.example.com/feed-9z8y.ics"],
];
/** A parsed CSV file: its rows and their row numbers in the file, `#` rows left out. */
const SECRET_CSV = { rows: SECRET_ROWS, rowNumbers: [3, 4] };
const SECRETS = [FEED_URL, "secret-token-a1b2c3", OBJECT_KEY, UPLOAD_ID, "4821", "sunshine99"];
const SECRET_CELLS = SECRET_ROWS.slice(1).flat();

const ENTRIES: FeedReadResponse = {
  entries: [
    { uid: "a1b2c3@airbnb.com", start: "2026-12-01", end: "2026-12-05", kind: "reservation" },
    { uid: "d4e5f6@airbnb.com", start: "2026-12-10", end: "2026-12-12", kind: "block" },
    { uid: "g7h8i9", start: "2026-12-20", end: "2026-12-21", kind: "unlabeled" },
  ],
  etag: ETAG,
  lastModified: null,
};
const NOT_MODIFIED: FeedReadResponse = {
  notModified: true,
  etag: ETAG,
  lastModified: LAST_MODIFIED,
};
const FEED_REQUEST: FeedReadRequest = { url: FEED_URL, etag: ETAG, lastModified: LAST_MODIFIED };
const SCREENSHOT: FileProcessRequest = { objectKey: OBJECT_KEY, purpose: "screenshot" };
const CSV: FileProcessRequest = { objectKey: OBJECT_KEY, purpose: "csv" };

// --- fakes ---

interface RecordedSpan {
  name: string;
  attributes: Record<string, unknown>;
  status?: SpanStatus;
  ended: boolean;
  other: unknown[];
}

/** Records every span the adapters start, with everything written to it. */
function fakeTracer(): { tracer: Tracer; spans: RecordedSpan[] } {
  const spans: RecordedSpan[] = [];
  const tracer = {
    startSpan: () => {
      throw new Error("adapters must use startActiveSpan");
    },
    startActiveSpan: (name: string, ...args: unknown[]) => {
      const fn = args.at(-1) as (span: Span) => unknown;
      const options = args.length > 1 ? (args[0] as { attributes?: object }) : undefined;
      const recorded: RecordedSpan = {
        name,
        attributes: { ...options?.attributes },
        ended: false,
        other: [],
      };
      spans.push(recorded);
      const span = {
        setAttribute: (key: string, value: unknown) => {
          recorded.attributes[key] = value;
          return span;
        },
        setAttributes: (attributes: object) => {
          Object.assign(recorded.attributes, attributes);
          return span;
        },
        setStatus: (status: SpanStatus) => {
          recorded.status = status;
          return span;
        },
        addEvent: (...event: unknown[]) => {
          recorded.other.push(event);
          return span;
        },
        addLink: (link: unknown) => {
          recorded.other.push(link);
          return span;
        },
        addLinks: (links: unknown) => {
          recorded.other.push(links);
          return span;
        },
        recordException: (exception: unknown) => {
          recorded.other.push(exception);
        },
        updateName: (newName: string) => {
          recorded.name = newName;
          return span;
        },
        end: () => {
          recorded.ended = true;
        },
        isRecording: () => true,
        spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 1 }),
      };
      return fn(span as unknown as Span);
    },
  };
  return { tracer: tracer as unknown as Tracer, spans };
}

type InvokeOutput = Awaited<ReturnType<LambdaInvokeClient["send"]>>;

interface RecordedInvoke {
  input: InvokeCommand["input"];
  signal: AbortSignal | undefined;
}

/** A Lambda client that answers every invoke with `respond`. */
function fakeLambda(respond: (call: RecordedInvoke) => Promise<InvokeOutput> | InvokeOutput) {
  const calls: RecordedInvoke[] = [];
  const client: LambdaInvokeClient = {
    send: async (command, options) => {
      const call = { input: command.input, signal: options?.abortSignal };
      calls.push(call);
      return respond(call);
    },
  };
  return { client, calls };
}

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const ok = (value: unknown): InvokeOutput => ({
  StatusCode: 200,
  Payload: encode(JSON.stringify(value)),
});
const decodePayload = (input: InvokeCommand["input"]): unknown =>
  JSON.parse(new TextDecoder().decode(input.Payload as Uint8Array));

function lambdaSandbox(respond: (call: RecordedInvoke) => Promise<InvokeOutput> | InvokeOutput) {
  const { tracer, spans } = fakeTracer();
  const { client, calls } = fakeLambda(respond);
  const sandbox = new LambdaSandbox({
    feedReaderFunction: "guidesk-feed-reader",
    fileProcessorFunction: "guidesk-file-processor",
    client,
    tracer,
  });
  return { sandbox, calls, spans };
}

function inProcessSandbox(
  feed: (request: FeedReadRequest) => Promise<FeedReadResponse> = async () => ENTRIES,
  file: (request: FileProcessRequest) => Promise<FileProcessResponse> = async () => ({
    text: SECRET_TEXT,
  }),
) {
  const { tracer, spans } = fakeTracer();
  const readFeed = vi.fn(feed);
  const processFile = vi.fn(file);
  const sandbox = new InProcessSandbox({ readFeed, processFile, tracer });
  return { sandbox, readFeed, processFile, spans };
}

/** Every span is one of ours, ended, with the three allowed attributes and no input or output. */
function expectCleanSpans(spans: RecordedSpan[]): void {
  expect(spans.length).toBeGreaterThan(0);
  for (const span of spans) {
    expect(span.name).toMatch(/^sandbox\.(feed-reader|file-processor)$/);
    expect(span.ended).toBe(true);
    expect(Object.keys(span.attributes).sort()).toEqual([
      "sandbox.duration_ms",
      "sandbox.function",
      "sandbox.outcome",
    ]);
    expect(span.name).toBe(`sandbox.${String(span.attributes["sandbox.function"])}`);
    expect(span.attributes["sandbox.outcome"]).toMatch(/^[a-z][a-z0-9_]*$/);
    expect(typeof span.attributes["sandbox.duration_ms"]).toBe("number");
    expect(span.other).toEqual([]);
    const serialized = JSON.stringify(span);
    for (const secret of [...SECRETS, ...SECRET_CELLS]) expect(serialized).not.toContain(secret);
  }
}

// Nothing in this file may write to the console or to the process streams.
let outputSpies: MockInstance[] = [];
beforeEach(() => {
  outputSpies = [
    ...(["log", "info", "warn", "error", "debug", "trace"] as const).map((method) =>
      vi.spyOn(console, method),
    ),
    vi.spyOn(process.stdout, "write"),
    vi.spyOn(process.stderr, "write"),
  ];
});
afterEach(() => {
  vi.useRealTimers();
  for (const spy of outputSpies) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

// --- protocol ---

describe("sandbox protocol", () => {
  it("accepts an HTTPS link with optional conditional headers, and nothing else", () => {
    expect(feedReadRequestSchema.safeParse(FEED_REQUEST).success).toBe(true);
    expect(feedReadRequestSchema.safeParse({ url: FEED_URL }).success).toBe(true);
    for (const url of [
      "http://calendar.example.com/feed.ics",
      "webcal://calendar.example.com/feed.ics",
      "ftp://calendar.example.com/feed.ics",
      "not a link",
      "",
    ]) {
      expect(feedReadRequestSchema.safeParse({ url }).success).toBe(false);
    }
    expect(feedReadRequestSchema.safeParse({ url: FEED_URL, extra: 1 }).success).toBe(false);
    expect(feedReadRequestSchema.safeParse({ url: FEED_URL, etag: "" }).success).toBe(false);
  });

  it("accepts only generated object keys and the two purposes", () => {
    expect(fileProcessRequestSchema.safeParse(SCREENSHOT).success).toBe(true);
    expect(fileProcessRequestSchema.safeParse(CSV).success).toBe(true);
    for (const objectKey of [
      "uploads/../../etc/passwd",
      `uploads/${WORKSPACE_ID}/listing.png`,
      `uploads/${WORKSPACE_ID}/${UPLOAD_ID}/`,
      `exports/${WORKSPACE_ID}/${UPLOAD_ID}`,
      `/uploads/${WORKSPACE_ID}/${UPLOAD_ID}`,
      `uploads/${WORKSPACE_ID.toUpperCase()}/${UPLOAD_ID}`,
    ]) {
      expect(fileProcessRequestSchema.safeParse({ objectKey, purpose: "csv" }).success).toBe(false);
    }
    expect(
      fileProcessRequestSchema.safeParse({ objectKey: OBJECT_KEY, purpose: "pdf" }).success,
    ).toBe(false);
  });

  it("accepts each feed response variant and the HTTP status codes", () => {
    for (const response of [
      ENTRIES,
      NOT_MODIFIED,
      { entries: [], etag: null, lastModified: null },
      { error: "blocked_address" },
      { error: "http_404" },
      { error: "http_503" },
    ]) {
      expect(feedReadResponseSchema.safeParse(response).success).toBe(true);
    }
    for (const error of ["http_99", "http_600", "http_4040", "http_", "not_implemented"]) {
      expect(feedReadResponseSchema.safeParse({ error }).success).toBe(false);
    }
  });

  it("refuses feed entries with any text besides the four fields, or invalid dates", () => {
    const entry = { uid: "a1", start: "2026-12-01", end: "2026-12-05", kind: "reservation" };
    const wrap = (entries: unknown[]) => ({ entries, etag: null, lastModified: null });
    expect(feedReadResponseSchema.safeParse(wrap([entry])).success).toBe(true);
    for (const bad of [
      { ...entry, summary: "Reserved - Ana +506 8888 8888" },
      { ...entry, description: "https://www.airbnb.com/hosting/reservations/details/HM1" },
      { ...entry, start: "2026-02-30" },
      { ...entry, end: "2026-12-05T00:00:00Z" },
      { ...entry, uid: "" },
      { ...entry, uid: "u".repeat(256) },
      { ...entry, kind: "cancelled" },
    ]) {
      expect(feedReadResponseSchema.safeParse(wrap([bad])).success).toBe(false);
    }
    const many = Array.from({ length: FEED_MAX_ENTRIES + 1 }, () => entry);
    expect(feedReadResponseSchema.safeParse(wrap(many)).success).toBe(false);
    expect(feedReadResponseSchema.safeParse({ ...ENTRIES, error: "internal" }).success).toBe(false);
  });

  it("limits recognized text and CSV rows", () => {
    expect(fileProcessResponseSchema.safeParse({ text: SECRET_TEXT }).success).toBe(true);
    expect(fileProcessResponseSchema.safeParse(SECRET_CSV).success).toBe(true);
    expect(fileProcessResponseSchema.safeParse({ error: "too_many_rows" }).success).toBe(true);
    expect(
      fileProcessResponseSchema.safeParse({ text: "x".repeat(FILE_MAX_TEXT_LENGTH + 1) }).success,
    ).toBe(false);
    const rows = Array.from({ length: FILE_MAX_ROWS + 1 }, () => ["a"]);
    const rowNumbers = rows.map((_, index) => index + 1);
    expect(fileProcessResponseSchema.safeParse({ rows, rowNumbers }).success).toBe(false);
    expect(fileProcessResponseSchema.safeParse({ rows: SECRET_ROWS }).success).toBe(false);
    expect(
      fileProcessResponseSchema.safeParse({ rows: SECRET_ROWS, rowNumbers: [1] }).success,
    ).toBe(false);
    expect(fileProcessResponseSchema.safeParse({ rows: [[1, 2]] }).success).toBe(false);
    expect(fileProcessResponseSchema.safeParse({ error: "not_implemented" }).success).toBe(false);
  });
});

// --- both adapters ---

interface AdapterUnderTest {
  sandbox: SandboxPort;
  invocations: () => number;
  spans: RecordedSpan[];
}

const adapters: [string, () => AdapterUnderTest][] = [
  [
    "LambdaSandbox",
    () => {
      const { sandbox, calls, spans } = lambdaSandbox(() => ok(ENTRIES));
      return { sandbox, invocations: () => calls.length, spans };
    },
  ],
  [
    "InProcessSandbox",
    () => {
      const { sandbox, readFeed, processFile, spans } = inProcessSandbox();
      return {
        sandbox,
        invocations: () => readFeed.mock.calls.length + processFile.mock.calls.length,
        spans,
      };
    },
  ],
];

describe.each(adapters)("%s (contract): requests", (_name, make) => {
  it("refuses a link that is not HTTPS before running the function", async () => {
    const { sandbox, invocations, spans } = make();
    for (const url of ["http://calendar.example.com/feed.ics", "webcal://x.example/a", "nope"]) {
      expect(await sandbox.readFeed({ url })).toEqual({ error: "not_https" });
    }
    expect(invocations()).toBe(0);
    expect(spans.map((span) => span.attributes["sandbox.outcome"])).toEqual([
      "not_https",
      "not_https",
      "not_https",
    ]);
    expectCleanSpans(spans);
  });

  it("returns internal for any other malformed feed request", async () => {
    const { sandbox, invocations, spans } = make();
    const bad = [
      { url: FEED_URL, etag: "" },
      { url: FEED_URL, summary: "Reserved" },
      { url: `https://calendar.example.com/${"a".repeat(2100)}` },
    ] as unknown as FeedReadRequest[];
    for (const request of bad) {
      expect(await sandbox.readFeed(request)).toEqual({ error: "internal" });
    }
    expect(invocations()).toBe(0);
    expectCleanSpans(spans);
  });

  it("refuses an object key that was not generated by the API", async () => {
    const { sandbox, invocations, spans } = make();
    const bad = [
      { objectKey: "uploads/../../etc/passwd", purpose: "csv" },
      { objectKey: `uploads/${WORKSPACE_ID}/listing.png`, purpose: "screenshot" },
      { objectKey: OBJECT_KEY, purpose: "pdf" },
    ] as FileProcessRequest[];
    for (const request of bad) {
      expect(await sandbox.processFile(request)).toEqual({ error: "internal" });
    }
    expect(invocations()).toBe(0);
    expect(spans.every((span) => span.status?.code === SpanStatusCode.ERROR)).toBe(true);
    expectCleanSpans(spans);
  });
});

// --- in-process ---

describe("InProcessSandbox (contract)", () => {
  it("passes each feed response variant through, with the checked request", async () => {
    for (const response of [ENTRIES, NOT_MODIFIED, { error: "http_404" }, { error: "timeout" }]) {
      const { sandbox, readFeed, spans } = inProcessSandbox(
        async () => response as FeedReadResponse,
      );
      expect(await sandbox.readFeed(FEED_REQUEST)).toEqual(response);
      expect(readFeed).toHaveBeenCalledWith(FEED_REQUEST);
      expectCleanSpans(spans);
    }
  });

  it("passes each file response variant through", async () => {
    const cases: [FileProcessRequest, FileProcessResponse][] = [
      [SCREENSHOT, { text: SECRET_TEXT }],
      [CSV, SECRET_CSV],
      [SCREENSHOT, { error: "unsupported_type" }],
      [CSV, { error: "too_many_rows" }],
    ];
    for (const [request, response] of cases) {
      const { sandbox, processFile, spans } = inProcessSandbox(undefined, async () => response);
      expect(await sandbox.processFile(request)).toEqual(response);
      expect(processFile).toHaveBeenCalledWith(request);
      expectCleanSpans(spans);
    }
  });

  it("returns internal when a handler throws, without the error text", async () => {
    const { sandbox, spans } = inProcessSandbox(
      async () => {
        throw new Error(`fetch failed for ${FEED_URL}`);
      },
      async () => {
        throw new Error(`OCR failed on ${OBJECT_KEY}: ${SECRET_TEXT}`);
      },
    );
    expect(await sandbox.readFeed(FEED_REQUEST)).toEqual({ error: "internal" });
    expect(await sandbox.processFile(SCREENSHOT)).toEqual({ error: "internal" });
    expect(spans.map((span) => span.status?.code)).toEqual([
      SpanStatusCode.ERROR,
      SpanStatusCode.ERROR,
    ]);
    expectCleanSpans(spans);
  });

  it("returns internal for a handler response outside the protocol", async () => {
    const leaky = {
      entries: [
        { uid: "a1", start: "2026-12-01", end: "2026-12-02", kind: "reservation", summary: "Ana" },
      ],
      etag: null,
      lastModified: null,
    } as unknown as FeedReadResponse;
    const feed = inProcessSandbox(async () => leaky);
    expect(await feed.sandbox.readFeed(FEED_REQUEST)).toEqual({ error: "internal" });

    const rowsForScreenshot = inProcessSandbox(undefined, async () => SECRET_CSV);
    expect(await rowsForScreenshot.sandbox.processFile(SCREENSHOT)).toEqual({ error: "internal" });
    const textForCsv = inProcessSandbox(undefined, async () => ({ text: SECRET_TEXT }));
    expect(await textForCsv.sandbox.processFile(CSV)).toEqual({ error: "internal" });
    expectCleanSpans([...feed.spans, ...rowsForScreenshot.spans, ...textForCsv.spans]);
  });

  it("works with the default tracer", async () => {
    const sandbox = new InProcessSandbox({
      readFeed: async () => NOT_MODIFIED,
      processFile: async () => SECRET_CSV,
    });
    expect(await sandbox.readFeed(FEED_REQUEST)).toEqual(NOT_MODIFIED);
    expect(await sandbox.processFile(CSV)).toEqual(SECRET_CSV);
  });
});

// --- Lambda ---

describe("LambdaSandbox (contract)", () => {
  it("invokes feed-reader synchronously with the request as JSON", async () => {
    const { sandbox, calls, spans } = lambdaSandbox(() => ok(ENTRIES));
    expect(await sandbox.readFeed(FEED_REQUEST)).toEqual(ENTRIES);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.input).toMatchObject({
      FunctionName: "guidesk-feed-reader",
      InvocationType: "RequestResponse",
    });
    expect(decodePayload(call!.input)).toEqual(FEED_REQUEST);
    expect(call?.signal).toBeInstanceOf(AbortSignal);
    expect(call?.signal?.aborted).toBe(false);
    expect(spans[0]?.attributes).toMatchObject({
      "sandbox.function": "feed-reader",
      "sandbox.outcome": "ok",
    });
    expectCleanSpans(spans);
  });

  it("invokes file-processor synchronously with the request as JSON", async () => {
    const { sandbox, calls, spans } = lambdaSandbox(() => ok({ text: SECRET_TEXT }));
    expect(await sandbox.processFile(SCREENSHOT)).toEqual({ text: SECRET_TEXT });
    expect(calls[0]?.input).toMatchObject({
      FunctionName: "guidesk-file-processor",
      InvocationType: "RequestResponse",
    });
    expect(decodePayload(calls[0]!.input)).toEqual(SCREENSHOT);
    expect(spans[0]?.attributes).toMatchObject({
      "sandbox.function": "file-processor",
      "sandbox.outcome": "ok",
    });
    expectCleanSpans(spans);
  });

  it("parses each feed response variant and records its outcome", async () => {
    const cases: [FeedReadResponse, string][] = [
      [ENTRIES, "ok"],
      [NOT_MODIFIED, "not_modified"],
      [{ error: "blocked_address" }, "blocked_address"],
      [{ error: "http_404" }, "http_404"],
      [{ error: "not_ical" }, "not_ical"],
    ];
    for (const [response, outcome] of cases) {
      const { sandbox, spans } = lambdaSandbox(() => ok(response));
      expect(await sandbox.readFeed({ url: FEED_URL })).toEqual(response);
      expect(spans[0]?.attributes["sandbox.outcome"]).toBe(outcome);
      expect(spans[0]?.status).toBeUndefined();
      expectCleanSpans(spans);
    }
  });

  it("parses each file response variant and records its outcome", async () => {
    const cases: [FileProcessRequest, FileProcessResponse, string][] = [
      [SCREENSHOT, { text: SECRET_TEXT }, "ok"],
      [CSV, SECRET_CSV, "ok"],
      [SCREENSHOT, { error: "unreadable" }, "unreadable"],
      [CSV, { error: "too_large" }, "too_large"],
      [CSV, { error: "not_found" }, "not_found"],
    ];
    for (const [request, response, outcome] of cases) {
      const { sandbox, spans } = lambdaSandbox(() => ok(response));
      expect(await sandbox.processFile(request)).toEqual(response);
      expect(spans[0]?.attributes["sandbox.outcome"]).toBe(outcome);
      expectCleanSpans(spans);
    }
  });

  it("maps function errors, unreadable payloads, and schema mismatches to internal", async () => {
    const unhandled = {
      errorType: "TypeError",
      errorMessage: `Cannot read ${FEED_URL}: ${SECRET_TEXT}`,
      trace: [],
    };
    const failures: InvokeOutput[] = [
      { StatusCode: 200, FunctionError: "Unhandled", Payload: encode(JSON.stringify(unhandled)) },
      { StatusCode: 200, FunctionError: "Unhandled", Payload: encode(JSON.stringify(ENTRIES)) },
      { StatusCode: 200, Payload: encode(`{"entries": [${FEED_URL}`) },
      { StatusCode: 200, Payload: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) },
      { StatusCode: 200 },
      { StatusCode: 500, Payload: encode(JSON.stringify(ENTRIES)) },
      ok({ error: "not_implemented" }),
      ok({
        ...ENTRIES,
        entries: [
          {
            uid: "a1",
            start: "2026-12-01",
            end: "2026-12-02",
            kind: "block",
            summary: SECRET_TEXT,
          },
        ],
      }),
      ok(SECRET_CSV),
      ok(null),
    ];
    for (const failure of failures) {
      const { sandbox, spans } = lambdaSandbox(() => failure);
      const feed = await sandbox.readFeed(FEED_REQUEST);
      const file = await sandbox.processFile(SCREENSHOT);
      expect(feed).toEqual({ error: "internal" });
      expect(file).toEqual({ error: "internal" });
      expect(spans.map((span) => span.status?.code)).toEqual([
        SpanStatusCode.ERROR,
        SpanStatusCode.ERROR,
      ]);
      expectCleanSpans(spans);
    }

    const textForCsv = lambdaSandbox(() => ok({ text: SECRET_TEXT }));
    expect(await textForCsv.sandbox.processFile(CSV)).toEqual({ error: "internal" });
  });

  it("maps a failed invoke to internal without reading the error", async () => {
    const { sandbox, spans } = lambdaSandbox(() => {
      throw Object.assign(new Error(`Invoke failed for ${FEED_URL} ${OBJECT_KEY}`), {
        name: "TooManyRequestsException",
      });
    });
    expect(await sandbox.readFeed(FEED_REQUEST)).toEqual({ error: "internal" });
    expect(await sandbox.processFile(CSV)).toEqual({ error: "internal" });
    expectCleanSpans(spans);
  });

  it("aborts a feed read after 15 seconds and reports a timeout", async () => {
    vi.useFakeTimers();
    const { sandbox, calls, spans } = lambdaSandbox(
      ({ signal }) =>
        new Promise<InvokeOutput>((_, reject) => {
          signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("Request aborted"), { name: "AbortError" })),
          );
        }),
    );
    const pending = sandbox.readFeed(FEED_REQUEST);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(calls[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(await pending).toEqual({ error: "timeout" });
    expect(spans[0]?.attributes["sandbox.outcome"]).toBe("timeout");
    expectCleanSpans(spans);
  });

  it("aborts a file after 60 seconds and reports internal", async () => {
    vi.useFakeTimers();
    const { sandbox, calls, spans } = lambdaSandbox(
      ({ signal }) =>
        new Promise<InvokeOutput>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("Request aborted")));
        }),
    );
    const pending = sandbox.processFile(SCREENSHOT);
    await vi.advanceTimersByTimeAsync(59_999);
    expect(calls[0]?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toEqual({ error: "internal" });
    expect(spans[0]?.attributes["sandbox.outcome"]).toBe("internal");
    expectCleanSpans(spans);
  });

  it("times out even when the client ignores the abort signal", async () => {
    vi.useFakeTimers();
    const { sandbox, spans } = lambdaSandbox(() => new Promise<InvokeOutput>(() => undefined));
    const feed = sandbox.readFeed(FEED_REQUEST);
    const file = sandbox.processFile(CSV);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await feed).toEqual({ error: "timeout" });
    expect(await file).toEqual({ error: "internal" });
    expectCleanSpans(spans);
  });
});
