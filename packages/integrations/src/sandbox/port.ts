import type {
  FeedReadRequest,
  FeedReadResponse,
  FileProcessRequest,
  FileProcessResponse,
} from "./protocol.js";

/**
 * Port to the isolated functions that handle untrusted content (research R2, SEC-09, SEC-10).
 * Host-supplied calendar links are read only by `feed-reader`, and uploaded files are read only
 * by `file-processor`; both run outside the VPC. The API and the worker reach them through this
 * port: `LambdaSandbox` in AWS, `InProcessSandbox` in development and test.
 *
 * Adapters never throw for a failed call and never log: every outcome is a response, and a
 * failure is an error code with no input or output text. Every call runs in an OpenTelemetry
 * span carrying only the function name, the outcome code, and the duration (constitution VIII).
 */
export interface SandboxPort {
  /** Reads one iCal link. An invalid or non-HTTPS link returns `{error: "not_https"}`. */
  readFeed(request: FeedReadRequest): Promise<FeedReadResponse>;
  /** Processes one uploaded object. An invalid object key returns `{error: "internal"}`. */
  processFile(request: FileProcessRequest): Promise<FileProcessResponse>;
}
