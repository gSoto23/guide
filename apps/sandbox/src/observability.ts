import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import type { ErrorEvent, NodeOptions } from "@sentry/node";
import { MINIMAL_DATA_COLLECTION, scrubEvent } from "@guidesk/observability/scrub";

/**
 * Observability for the sandbox functions (constitution VIII, research R13). Their inputs are
 * host-supplied links and uploaded files, and their outputs are feed entries, recognized text, or
 * CSV rows. None of it may reach a log line or an error report, so this module only ever writes
 * the function name, a request ID, an outcome code, and a duration.
 */
export type SandboxFunction = "feed-reader" | "file-processor";

export interface InvocationLog {
  fn: SandboxFunction;
  requestId: string;
  outcome: string;
  durationMs: number;
}

/** Outcome codes are short identifiers; anything else is replaced so no text can leak. */
const OUTCOME_CODE = /^[a-z][a-z0-9_]{0,39}$/;

function safeOutcome(outcome: string): string {
  return OUTCOME_CODE.test(outcome) ? outcome : "invalid_outcome";
}

/** Writes one structured JSON log line with the four allowed fields and nothing else. */
export function logInvocation(
  line: InvocationLog,
  write: (text: string) => void = (text) => void process.stdout.write(text),
): void {
  const record = {
    level: line.outcome === "ok" ? "info" : "warn",
    fn: line.fn,
    requestId: line.requestId,
    outcome: safeOutcome(line.outcome),
    durationMs: Math.round(line.durationMs),
  };
  write(`${JSON.stringify(record)}\n`);
}

/** Context names that describe the runtime, never the request. */
const ALLOWED_CONTEXTS = new Set(["os", "runtime", "trace", "cloud_resource"]);

/**
 * The API's allowlist (`scrubEvent`), plus what the sandbox cannot keep: exception messages
 * (an error raised while reading a feed can quote the link), log messages, breadcrumbs, local
 * variables in stack frames, request data, and any context that is not about the runtime.
 * The exception type and stack frames remain, which is enough to find the failing code.
 */
export function sandboxBeforeSend(event: ErrorEvent): ErrorEvent {
  const scrubbed = scrubEvent(event);
  for (const exception of scrubbed.exception?.values ?? []) {
    if (exception.value !== undefined) exception.value = "[redacted]";
    for (const frame of exception.stacktrace?.frames ?? []) delete frame.vars;
  }
  delete scrubbed.message;
  delete scrubbed.logentry;
  delete scrubbed.breadcrumbs;
  delete scrubbed.request;
  delete scrubbed.extra;
  if (scrubbed.contexts) {
    scrubbed.contexts = Object.fromEntries(
      Object.entries(scrubbed.contexts).filter(([name]) => ALLOWED_CONTEXTS.has(name)),
    );
  }
  return scrubbed;
}

/**
 * Starts Sentry when a DSN is configured. Breadcrumbs are never recorded (they would hold the
 * URLs the feed reader requests), tracing is off, and every event passes `sandboxBeforeSend`.
 */
export function initSandboxSentry(
  fn: SandboxFunction,
  options: Pick<NodeOptions, "dsn" | "transport"> = {},
): void {
  const dsn = options.dsn ?? process.env.SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    transport: options.transport,
    environment: process.env.NODE_ENV ?? "development",
    dataCollection: MINIMAL_DATA_COLLECTION,
    // The default appends the requested host to fetch errors, which would name the feed's host.
    enhanceFetchErrorMessages: false,
    initialScope: { tags: { fn } },
    beforeBreadcrumb: () => null,
    beforeSend: (event) => sandboxBeforeSend(event),
    beforeSendTransaction: () => null,
  });
}

export interface InvocationContext {
  requestId: string;
}

/** What a failed invocation returns to the caller: a code, never the error text. */
export const INTERNAL_ERROR = { error: "internal" } as const;

/**
 * Wraps a handler: one log line per invocation, and an error report with the message removed
 * when the handler throws. Handlers report expected failures as `{error: code}` results; the
 * code becomes the logged outcome.
 */
export function instrumentHandler<Input, Output extends object>(
  fn: SandboxFunction,
  handler: (input: Input, context: InvocationContext) => Promise<Output>,
  deps: { write?: (text: string) => void; now?: () => number } = {},
): (
  input: Input,
  lambdaContext?: { awsRequestId?: string },
) => Promise<Output | typeof INTERNAL_ERROR> {
  const now = deps.now ?? (() => performance.now());
  return async (input, lambdaContext) => {
    const requestId = lambdaContext?.awsRequestId ?? randomUUID();
    const started = now();
    let outcome = "ok";
    try {
      const result = await handler(input, { requestId });
      const code = (result as { error?: unknown }).error;
      if (typeof code === "string") outcome = code;
      return result;
    } catch (error: unknown) {
      outcome = "internal";
      Sentry.captureException(error, { tags: { fn } });
      await Sentry.flush(2000);
      return INTERNAL_ERROR;
    } finally {
      logInvocation({ fn, requestId, outcome, durationMs: now() - started }, deps.write);
    }
  };
}
