import { UnreadableImageError, type TextRecognitionPort } from "@guidesk/integrations/ocr-port";
import { initSandboxSentry, instrumentHandler } from "../observability.js";
import {
  FILE_MAX_TEXT_LENGTH,
  fileProcessRequestSchema,
  type FileProcessRequest,
  type FileProcessResponse,
} from "../protocol.js";
import { parseCsvFile } from "./csv.js";
import { detectImageType, normalizeImage } from "./images.js";
import { TesseractRecognizer } from "./ocr.js";
import { S3ObjectSource } from "./s3-source.js";

/**
 * File processor (research R2, R3, R9, SEC-10, AC-SEC-005): reads one uploaded object, checks
 * its real type by magic bytes, re-encodes the image, recognizes its text, deletes the object,
 * and returns the text or an error code. In AWS it is a Lambda function outside the VPC whose
 * role can only read and delete `uploads/*`; in development and test the worker runs the same
 * code in process (`SANDBOX_MODE=in-process`) through `createFileProcessor`.
 *
 * It never reaches the database and never sends an image anywhere: images never go to the AI
 * (AC-SEC-014), only the recognized text is returned. That text is confidential and is never
 * logged; `instrumentHandler` logs only the request ID, the outcome code, and the duration.
 */

export { TesseractRecognizer, type TesseractRecognizerOptions } from "./ocr.js";
export type { TextRecognitionPort } from "@guidesk/integrations/ocr-port";

/** Largest file accepted: 10 MB, as for the upload form (FR-009). */
export const FILE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Longest text recognition may run. It leaves time within the function's 60 seconds
 * (infra/sandbox.ts, FR-016) to delete the object and answer.
 */
export const RECOGNITION_TIMEOUT_MS = 45_000;

/** Where uploaded objects are read from and deleted: S3 in AWS, injected by the worker locally. */
export interface ObjectSource {
  /** The object's bytes, or null when it does not exist. */
  get(key: string): Promise<Buffer | null>;
  /** Deletes the object; deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
}

export interface FileProcessorDeps {
  storage: ObjectSource;
  recognizer: TextRecognitionPort;
  /** Defaults to `FILE_MAX_BYTES`. */
  maxBytes?: number;
  /** Defaults to `RECOGNITION_TIMEOUT_MS`. */
  recognitionTimeoutMs?: number;
}

/**
 * Builds the processor. For each request it:
 *
 * 1. validates the request against the protocol schema (`internal` when it does not match: the
 *    API generates object keys, so a bad one is a bug);
 * 2. reads the object (`not_found` when it does not exist);
 * 3. processes it: a CSV file is parsed into rows (`csv.ts`, FR-038); a screenshot over
 *    `maxBytes` is `too_large`, one that is not JPEG, PNG, or WebP by its magic bytes is
 *    `unsupported_type`, and one that cannot be decoded or shows no text is `unreadable`;
 * 4. deletes the object, after success and after every failure, a thrown error included (FR-015).
 *
 * A result is returned only once the object is deleted: when the delete fails, the call throws
 * and the bucket's 1-day lifecycle rule remains the backstop (research R9).
 */
export function createFileProcessor(
  deps: FileProcessorDeps,
): (request: FileProcessRequest) => Promise<FileProcessResponse> {
  return async (request) => {
    const parsed = fileProcessRequestSchema.safeParse(request);
    if (!parsed.success) return { error: "internal" };
    const { objectKey, purpose } = parsed.data;

    const bytes = await deps.storage.get(objectKey);
    if (bytes === null) return { error: "not_found" };
    try {
      if (purpose === "csv") return parseCsvFile(bytes);
      return await recognizeScreenshot(bytes, deps);
    } finally {
      await deps.storage.delete(objectKey);
    }
  };
}

async function recognizeScreenshot(
  bytes: Buffer,
  deps: FileProcessorDeps,
): Promise<FileProcessResponse> {
  if (bytes.length > (deps.maxBytes ?? FILE_MAX_BYTES)) return { error: "too_large" };
  const type = detectImageType(bytes);
  if (type === null) return { error: "unsupported_type" };

  const normalized = await normalizeImage(bytes, type);
  if ("error" in normalized) return normalized;

  const signal = AbortSignal.timeout(deps.recognitionTimeoutMs ?? RECOGNITION_TIMEOUT_MS);
  let text: string;
  try {
    text = await deps.recognizer.recognize(normalized.image, { signal });
  } catch (error: unknown) {
    // A screenshot that cannot be read within the time limit is reported like any unreadable one.
    if (error instanceof UnreadableImageError || signal.aborted) return { error: "unreadable" };
    throw error;
  }

  const trimmed = text.trim();
  if (trimmed === "") return { error: "unreadable" };
  return { text: truncate(trimmed, FILE_MAX_TEXT_LENGTH) };
}

/** Cuts the text to `max` UTF-16 units without splitting a surrogate pair. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? max - 1 : max;
  return text.slice(0, end);
}

let lambdaProcessor: ((request: FileProcessRequest) => Promise<FileProcessResponse>) | null = null;
let sentryStarted = false;

/**
 * The processor the Lambda function uses: S3 on `UPLOADS_BUCKET` and one Tesseract worker kept
 * across invocations, with the models bundled next to the handler (`TESSERACT_LANG_PATH`). It is
 * built on the first invocation, so importing this module (as the worker does) starts nothing.
 */
function processorFromEnvironment(): (request: FileProcessRequest) => Promise<FileProcessResponse> {
  if (lambdaProcessor) return lambdaProcessor;
  if (!sentryStarted) {
    initSandboxSentry("file-processor");
    sentryStarted = true;
  }
  const bucket = process.env.UPLOADS_BUCKET;
  if (!bucket) throw new Error("UPLOADS_BUCKET is not set");
  lambdaProcessor = createFileProcessor({
    storage: new S3ObjectSource({ bucket, maxBytes: FILE_MAX_BYTES }),
    recognizer: new TesseractRecognizer(),
  });
  return lambdaProcessor;
}

/** The Lambda entry point (infra/sandbox.ts). */
export const handler = instrumentHandler("file-processor", (request: FileProcessRequest) =>
  processorFromEnvironment()(request),
);
