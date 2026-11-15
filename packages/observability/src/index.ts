import * as Sentry from "@sentry/node";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

/** Keys that may leave the process in error reports; everything else is dropped (SEC-06). */
const ALLOWED_REQUEST_KEYS = new Set(["method", "url"]);

/** Invitation links carry their token in the path (`/invite/<token>`, `/invitations/<token>`). */
const INVITATION_TOKEN_IN_PATH = /\/(invite|invitations)\/[A-Za-z0-9_-]{43}(?=\/|$)/g;

/**
 * Removes the query string, which can carry OAuth codes or other one-time values, and the token
 * of invitation links (T103).
 */
export function stripQuery(url: string): string {
  const cut = url.search(/[?#]/);
  const path = cut === -1 ? url : url.slice(0, cut);
  return path.replace(INVITATION_TOKEN_IN_PATH, "/$1/[token]");
}

/**
 * Removes bound parameters from database error messages. Drizzle appends them as
 * "params: ..." and they can hold session tokens, emails, or IP addresses (T103).
 */
export function redactQueryParams(message: string): string {
  return message.replace(/\n?params:[\s\S]*$/, "\nparams: [redacted]");
}

/**
 * A loggable description of an error: name, redacted message, the driver's error code, and the
 * stack frames. Never the bound query parameters (SEC-06).
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as { cause?: { code?: unknown; message?: unknown } }).cause;
  const causeText =
    cause && typeof cause === "object"
      ? ` (cause: ${typeof cause.code === "string" ? `${cause.code} ` : ""}${
          typeof cause.message === "string" ? redactQueryParams(cause.message) : ""
        })`
      : "";
  const frames = (error.stack ?? "")
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .join("\n");
  return `${error.name}: ${redactQueryParams(error.message)}${causeText}${frames ? `\n${frames}` : ""}`;
}

/**
 * Allowlist-based scrubbing: no cookies, headers, bodies, query strings, extra data, or user
 * emails in error reports; database parameters are redacted from exception messages.
 */
export function scrubEvent<T extends Sentry.ErrorEvent>(event: T): T {
  if (event.request) {
    const kept = Object.fromEntries(
      Object.entries(event.request).filter(([key]) => ALLOWED_REQUEST_KEYS.has(key)),
    ) as T["request"] & { url?: string };
    if (typeof kept.url === "string") kept.url = stripQuery(kept.url);
    event.request = kept;
  }
  if (event.user) {
    event.user = event.user.id ? { id: event.user.id } : {};
  }
  delete event.extra;
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value === "string") exception.value = redactQueryParams(exception.value);
  }
  if (typeof event.message === "string") event.message = redactQueryParams(event.message);
  for (const breadcrumb of event.breadcrumbs ?? []) scrubBreadcrumb(breadcrumb);
  return event;
}

/** Breadcrumbs keep their category and level; URLs lose the query and messages lose params. */
export function scrubBreadcrumb(breadcrumb: Sentry.Breadcrumb): Sentry.Breadcrumb {
  if (breadcrumb.data) {
    const data: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(breadcrumb.data)) {
      if (key === "url" && typeof value === "string") data.url = stripQuery(value);
      else if (key === "method" || key === "status_code") data[key] = value;
    }
    breadcrumb.data = data;
  }
  if (typeof breadcrumb.message === "string") {
    breadcrumb.message = redactQueryParams(breadcrumb.message);
  }
  return breadcrumb;
}

let sdk: NodeSDK | undefined;

/** Starts OpenTelemetry and Sentry when configured (T025). Import before anything else. */
export function initObservability(serviceName: string): void {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? "development",
      beforeSend: (event) => scrubEvent(event),
      beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
      beforeSendTransaction: (event) => {
        if (event.request?.url) event.request = { url: stripQuery(event.request.url) };
        else delete event.request;
        delete event.extra;
        return event;
      },
    });
  }
  if (process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    sdk = new NodeSDK({
      serviceName,
      traceExporter: new OTLPTraceExporter(),
      instrumentations: [
        getNodeAutoInstrumentations({
          "@opentelemetry/instrumentation-fs": { enabled: false },
          // OAuth callbacks carry one-time codes in the query string, and public invitation
          // routes carry the token in the path: never trace them (T103).
          "@opentelemetry/instrumentation-http": {
            ignoreIncomingRequestHook: (request) =>
              (request.url?.startsWith("/api/auth/callback") ?? false) ||
              (request.url?.startsWith("/api/v1/invitations/") ?? false),
          },
        }),
      ],
    });
    sdk.start();
  }
}

export async function shutdownObservability(): Promise<void> {
  await Promise.allSettled([sdk?.shutdown(), Sentry.close(2000)]);
}
