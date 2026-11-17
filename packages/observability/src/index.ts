import * as Sentry from "@sentry/node";
import { MINIMAL_DATA_COLLECTION, scrubBreadcrumb, scrubEvent, stripQuery } from "./scrub.js";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

export * from "./scrub.js";

let sdk: NodeSDK | undefined;

/** Starts OpenTelemetry and Sentry when configured (T025). Import before anything else. */
export function initObservability(serviceName: string): void {
  if (process.env.SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      environment: process.env.NODE_ENV ?? "development",
      dataCollection: MINIMAL_DATA_COLLECTION,
      enhanceFetchErrorMessages: false,
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
