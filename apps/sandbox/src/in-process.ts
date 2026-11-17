/**
 * The sandbox handlers without their Lambda wiring (no Sentry start-up, no environment reads),
 * for `SANDBOX_MODE=in-process` in development and tests (research R2). The API and the worker
 * inject them into `InProcessSandbox`.
 */
export { createFeedReader, type FeedReaderDeps } from "./feed-reader/reader.js";
export { createPinnedSend, isPublicAddress } from "./feed-reader/safe-fetch.js";
export {
  createFileProcessor,
  type FileProcessorDeps,
  type ObjectSource,
} from "./file-processor/handler.js";
export { TesseractRecognizer } from "./file-processor/ocr.js";
