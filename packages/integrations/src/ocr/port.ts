/**
 * Text recognition for listing screenshots (research R3, FR-009). The adapter runs inside the
 * `file-processor` sandbox function (research R2, SEC-10), on images that already passed the
 * magic-byte check and were re-encoded to a grayscale PNG with no metadata (AC-SEC-005).
 *
 * Images never reach the language model (research R3, AC-SEC-014): only the recognized text
 * leaves the sandbox, and it is redacted by the worker before any AI call (research R4). That
 * text is confidential, so adapters never log it and never put it in an error.
 *
 * Tesseract (`TesseractRecognizer` in `apps/sandbox`) is the adapter in this feature; Amazon
 * Textract `DetectDocumentText` is the alternative kept behind the same port (R3 accuracy gate).
 *
 * This module has no imports and no runtime dependencies: `apps/sandbox` loads it on its own
 * through the `@guidesk/integrations/ocr-port` entry, which carries no provider SDK.
 */
export interface TextRecognitionPort {
  /**
   * Recognizes the text of one image. Resolves with the text, which is empty when the image
   * shows none. Rejects with `UnreadableImageError` when the engine cannot read the image, and
   * with the signal's reason when `signal` aborts first.
   */
  recognize(image: Buffer, options?: { signal?: AbortSignal }): Promise<string>;
}

/** The engine could not read the image. Carries no image data, engine output, or text. */
export class UnreadableImageError extends Error {
  constructor() {
    super("The image could not be read");
    this.name = "UnreadableImageError";
  }
}
