import { SpanStatusCode, trace, type Tracer } from "@opentelemetry/api";

/** The two sandbox functions (research R2). */
export type SandboxFunction = "feed-reader" | "file-processor";

/** The tracer adapters use unless one is injected. */
export function defaultSandboxTracer(): Tracer {
  return trace.getTracer("@guidesk/integrations");
}

/** Outcome codes are short identifiers; anything else is replaced so no text can leak. */
const OUTCOME_CODE = /^[a-z][a-z0-9_]{0,39}$/;

/** `ok`, `not_modified` for a feed that did not change, or the error code of the response. */
export function outcomeOf(response: object): string {
  if ("error" in response) {
    const code = response.error;
    return typeof code === "string" && OUTCOME_CODE.test(code) ? code : "invalid_outcome";
  }
  return "notModified" in response ? "not_modified" : "ok";
}

/**
 * Runs one sandbox call in an OpenTelemetry span (constitution VIII, research R13). The span
 * carries exactly three attributes: `sandbox.function`, `sandbox.outcome`, and
 * `sandbox.duration_ms`. Inputs and outputs (feed links, object keys, recognized text, CSV rows)
 * never reach it, and no exception is recorded, because an error message could quote them.
 */
export function withSandboxSpan<T extends object>(
  tracer: Tracer,
  fn: SandboxFunction,
  call: () => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(`sandbox.${fn}`, async (span) => {
    const started = performance.now();
    let outcome = "internal";
    try {
      const response = await call();
      outcome = outcomeOf(response);
      return response;
    } finally {
      span.setAttributes({
        "sandbox.function": fn,
        "sandbox.outcome": outcome,
        "sandbox.duration_ms": Math.round(performance.now() - started),
      });
      if (outcome === "internal") span.setStatus({ code: SpanStatusCode.ERROR });
      span.end();
    }
  });
}
