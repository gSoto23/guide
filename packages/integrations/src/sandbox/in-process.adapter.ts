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

/** The sandbox handler functions, injected by the worker from `apps/sandbox`. */
export interface SandboxHandlers {
  readFeed: (request: FeedReadRequest) => Promise<FeedReadResponse>;
  processFile: (request: FileProcessRequest) => Promise<FileProcessResponse>;
}

export interface InProcessSandboxOptions extends SandboxHandlers {
  tracer?: Tracer;
}

/**
 * Runs the sandbox handlers inside the calling process, for development and test only (research
 * R2). The config loader refuses `SANDBOX_MODE=in-process` in production (T006). The handlers are
 * injected, so this package never depends on `apps/sandbox`.
 *
 * Requests and responses pass the same checks as with `LambdaSandbox`, and the same span is
 * recorded. A handler that throws returns `{error: "internal"}`; its error is dropped unread,
 * because the message could quote a feed link or recognized text.
 */
export class InProcessSandbox implements SandboxPort {
  private readonly tracer: Tracer;

  constructor(private readonly options: InProcessSandboxOptions) {
    this.tracer = options.tracer ?? defaultSandboxTracer();
  }

  readFeed(request: FeedReadRequest): Promise<FeedReadResponse> {
    return withSandboxSpan(this.tracer, "feed-reader", async () => {
      const checked = checkFeedRequest(request);
      if ("response" in checked) return checked.response;
      try {
        return checkFeedResponse(await this.options.readFeed(checked.request));
      } catch {
        return { error: "internal" };
      }
    });
  }

  processFile(request: FileProcessRequest): Promise<FileProcessResponse> {
    return withSandboxSpan(this.tracer, "file-processor", async () => {
      const checked = checkFileRequest(request);
      if ("response" in checked) return checked.response;
      try {
        const response = await this.options.processFile(checked.request);
        return checkFileResponse(checked.request.purpose, response);
      } catch {
        return { error: "internal" };
      }
    });
  }
}
