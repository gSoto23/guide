import {
  metrics,
  SpanStatusCode,
  trace,
  type Attributes,
  type Counter,
  type Span,
  type Tracer,
} from "@opentelemetry/api";

/**
 * Spans and failure counts for worker jobs (constitution VIII, research R13). A job span carries
 * the queue, the workspace ID, and counts. Restricted values (feed links, PMS credentials, codes)
 * and guest names never become attributes: only the keys below are kept, with short plain values.
 */
const ALLOWED_ATTRIBUTES = new Set([
  "job.queue",
  "workspace.id",
  "job.items",
  "job.created",
  "job.updated",
  "job.needs_details",
  "job.failed",
  "job.skipped",
  "job.stays",
  "job.outcome",
  "pms.provider",
  "feed.channel",
  "error.code",
]);

/** Short identifiers and IDs only; anything that could be free text is dropped. */
const SAFE_STRING = /^[A-Za-z0-9_.:-]{0,64}$/;

export function safeAttributes(input: Record<string, unknown>): Attributes {
  const kept: Attributes = {};
  for (const [key, value] of Object.entries(input)) {
    if (!ALLOWED_ATTRIBUTES.has(key)) continue;
    if (typeof value === "number" || typeof value === "boolean") kept[key] = value;
    else if (typeof value === "string" && SAFE_STRING.test(value)) kept[key] = value;
  }
  return kept;
}

export interface JobSpan {
  /** Adds allowed attributes, such as counts, to the job's span. */
  set(attributes: Record<string, unknown>): void;
  /** Counts one failure per provider and error code (for example a refresh that failed). */
  recordFailure(errorCode: string, provider?: string): void;
}

export interface JobSpanDeps {
  tracer?: Tracer;
  failures?: Pick<Counter, "add">;
}

function defaultFailures(): Pick<Counter, "add"> {
  return metrics.getMeter("@guidesk/worker").createCounter("guidesk.job.failures", {
    description: "Worker job failures per queue, provider, and error code",
  });
}

/**
 * Runs a job inside a span. A thrown error marks the span as failed and counts an `internal`
 * failure; its message is never recorded, because it may quote the data the job handled.
 */
export async function runInJobSpan<T>(
  options: { queue: string; workspaceId?: string; attributes?: Record<string, unknown> },
  fn: (span: JobSpan) => Promise<T>,
  deps: JobSpanDeps = {},
): Promise<T> {
  const tracer = deps.tracer ?? trace.getTracer("@guidesk/worker");
  const failures = deps.failures ?? defaultFailures();
  const base = { "job.queue": options.queue, "workspace.id": options.workspaceId };
  return tracer.startActiveSpan(
    `job ${options.queue}`,
    { attributes: safeAttributes({ ...options.attributes, ...base }) },
    async (span: Span) => {
      const handle: JobSpan = {
        set: (attributes) => span.setAttributes(safeAttributes(attributes)),
        recordFailure: (errorCode, provider) =>
          failures.add(
            1,
            safeAttributes({
              "job.queue": options.queue,
              "error.code": errorCode,
              "pms.provider": provider,
            }),
          ),
      };
      try {
        const result = await fn(handle);
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error: unknown) {
        span.setStatus({ code: SpanStatusCode.ERROR });
        span.setAttributes(safeAttributes({ "error.code": "internal" }));
        handle.recordFailure("internal");
        throw error;
      } finally {
        span.end();
      }
    },
  );
}
