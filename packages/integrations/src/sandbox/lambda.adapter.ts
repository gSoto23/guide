import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import type { Tracer } from "@opentelemetry/api";
import {
  checkFeedRequest,
  checkFeedResponse,
  checkFileRequest,
  checkFileResponse,
} from "./checks.js";
import type { SandboxPort } from "./port.js";
import type {
  FeedReadRequest,
  FeedReadResponse,
  FileProcessRequest,
  FileProcessResponse,
} from "./protocol.js";
import { defaultSandboxTracer, withSandboxSpan } from "./span.js";

/** Time budget of a feed read, retries included. The function itself stops at 10 s (R2). */
export const FEED_READ_TIMEOUT_MS = 15_000;
/** Time budget of a file, retries included: the extraction target is 60 s (R3, FR-016). */
export const FILE_PROCESS_TIMEOUT_MS = 60_000;

/** The part of `LambdaClient` the adapter uses, so tests can inject a fake. */
export interface LambdaInvokeClient {
  send(
    command: InvokeCommand,
    options?: { abortSignal?: AbortSignal },
  ): Promise<{ StatusCode?: number; FunctionError?: string; Payload?: Uint8Array }>;
}

export interface LambdaSandboxOptions {
  /** Name or ARN of the `feed-reader` function. */
  feedReaderFunction: string;
  /** Name or ARN of the `file-processor` function. */
  fileProcessorFunction: string;
  client?: LambdaInvokeClient;
  tracer?: Tracer;
}

type Invocation = { kind: "payload"; payload: unknown } | { kind: "timeout" } | { kind: "failed" };

/**
 * Calls the sandbox functions with a synchronous Lambda invoke (research R2, SEC-09, SEC-10).
 * The response is limited to 6 MB by Lambda; the protocol's own limits stay well below it.
 *
 * Feed links, object keys, recognized text, and CSV rows are never logged, never put in a span,
 * and never copied into an error. A function error, an unreadable payload, or a payload that does
 * not match the protocol becomes `{error: "internal"}`; Lambda's error payload is never read.
 * Credentials come from the ECS task role.
 */
export class LambdaSandbox implements SandboxPort {
  private readonly client: LambdaInvokeClient;
  private readonly tracer: Tracer;

  constructor(private readonly options: LambdaSandboxOptions) {
    // The functions live in the stack's region (ADR-0009).
    this.client = options.client ?? new LambdaClient({ region: "us-east-1" });
    this.tracer = options.tracer ?? defaultSandboxTracer();
  }

  readFeed(request: FeedReadRequest): Promise<FeedReadResponse> {
    return withSandboxSpan(this.tracer, "feed-reader", async () => {
      const checked = checkFeedRequest(request);
      if ("response" in checked) return checked.response;
      const result = await this.invoke(
        this.options.feedReaderFunction,
        checked.request,
        FEED_READ_TIMEOUT_MS,
      );
      if (result.kind === "timeout") return { error: "timeout" };
      if (result.kind === "failed") return { error: "internal" };
      return checkFeedResponse(result.payload);
    });
  }

  processFile(request: FileProcessRequest): Promise<FileProcessResponse> {
    return withSandboxSpan(this.tracer, "file-processor", async () => {
      const checked = checkFileRequest(request);
      if ("response" in checked) return checked.response;
      const result = await this.invoke(
        this.options.fileProcessorFunction,
        checked.request,
        FILE_PROCESS_TIMEOUT_MS,
      );
      if (result.kind !== "payload") return { error: "internal" };
      return checkFileResponse(checked.request.purpose, result.payload);
    });
  }

  /**
   * One synchronous invoke within `timeoutMs`. The abort signal cancels the HTTP request, and the
   * race also covers steps that ignore it (credential resolution, a client that hangs). Errors are
   * reduced to a kind: their messages are never read.
   */
  private async invoke(
    functionName: string,
    request: unknown,
    timeoutMs: number,
  ): Promise<Invocation> {
    const controller = new AbortController();
    const timedOut = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("timeout")), {
        once: true,
      });
    });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const output = await Promise.race([
        this.client.send(
          new InvokeCommand({
            FunctionName: functionName,
            InvocationType: "RequestResponse",
            Payload: new TextEncoder().encode(JSON.stringify(request)),
          }),
          { abortSignal: controller.signal },
        ),
        timedOut,
      ]);
      if (output.FunctionError !== undefined) return { kind: "failed" };
      if (output.StatusCode !== undefined && output.StatusCode !== 200) return { kind: "failed" };
      if (output.Payload === undefined) return { kind: "failed" };
      const text = new TextDecoder("utf-8", { fatal: true }).decode(output.Payload);
      return { kind: "payload", payload: JSON.parse(text) as unknown };
    } catch {
      return controller.signal.aborted ? { kind: "timeout" } : { kind: "failed" };
    } finally {
      clearTimeout(timer);
    }
  }
}
