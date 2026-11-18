import type { TextRecognitionPort } from "@guidesk/integrations/ocr-port";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  FILE_MAX_TEXT_LENGTH,
  type FileProcessResponse,
} from "@guidesk/integrations/sandbox-protocol";

/** The largest PDF (feature 003 FR-039). */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;
/** Pages read from one PDF (research R9). */
export const PDF_MAX_PAGES = 60;
/** Scanned pages read by recognition from one PDF, behind `guide.scannedPdf` (R9). */
export const PDF_MAX_SCANNED_PAGES = 20;
/** A page with less text than this is treated as scanned. */
const SCANNED_PAGE_CHARS = 20;
/** Scanned pages render at twice their size, so small print stays readable. */
const RENDER_SCALE = 2;

export interface PdfOptions {
  recognizer: TextRecognitionPort;
  /** `guide.scannedPdf`: read scanned pages by recognition (R9). */
  readScannedPages: boolean;
  maxBytes?: number;
  signal?: AbortSignal;
}

function isPdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString("latin1") === "%PDF-";
}

/** Cuts the text to `max` UTF-16 units without splitting a surrogate pair. */
function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const last = text.charCodeAt(max - 1);
  return text.slice(0, last >= 0xd800 && last <= 0xdbff ? max - 1 : max);
}

/**
 * The `document` mode of the file processor (feature 003 T108, research R9, FR-042): reads the
 * text of a PDF of at most 60 pages with `pdfjs-dist`, rejects encrypted files, and, behind the
 * flag, renders pages with almost no text and reads them with the recognizer. Only text leaves the
 * sandbox, never an image. Scripts, forms, and fonts inside the PDF are never run or loaded.
 */
export async function readPdf(bytes: Buffer, options: PdfOptions): Promise<FileProcessResponse> {
  if (bytes.length > (options.maxBytes ?? PDF_MAX_BYTES)) return { error: "too_large" };
  if (!isPdf(bytes)) return { error: "unsupported_type" };

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    stopAtErrors: false,
    verbosity: 0,
  });
  let document: Awaited<typeof task.promise>;
  try {
    document = await task.promise;
  } catch (error: unknown) {
    await task.destroy().catch(() => undefined);
    if (error instanceof pdfjs.PasswordException) return { error: "password_protected" };
    return { error: "unreadable" };
  }
  try {
    if (document.numPages > PDF_MAX_PAGES) return { error: "too_many_pages" };
    const pages: string[] = [];
    let scannedPages = 0;
    let recognized = 0;
    for (let number = 1; number <= document.numPages; number += 1) {
      if (options.signal?.aborted) return { error: "unreadable" };
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
        .join("")
        .replace(/[ \t]+\n/g, "\n")
        .trim();
      if (text.replace(/\s/g, "").length >= SCANNED_PAGE_CHARS) {
        pages.push(text);
        page.cleanup();
        continue;
      }
      scannedPages += 1;
      if (options.readScannedPages && recognized < PDF_MAX_SCANNED_PAGES) {
        recognized += 1;
        const image = await renderPage(page);
        const read = await options.recognizer
          .recognize(image, options.signal ? { signal: options.signal } : undefined)
          .catch(() => "");
        if (read.trim()) pages.push(read.trim());
      } else if (text) {
        pages.push(text);
      }
      page.cleanup();
    }
    return {
      text: truncate(pages.join("\n\n"), FILE_MAX_TEXT_LENGTH),
      pages: document.numPages,
      scannedPages,
    };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Renders one page to a PNG for the recognizer; the image stays in the sandbox. */
async function renderPage(page: PDFPageProxy): Promise<Buffer> {
  const { createCanvas } = await import("@napi-rs/canvas");
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  // The Node canvas stands in for the browser's; pdfjs uses only the 2D drawing calls.
  type RenderParameters = Parameters<PDFPageProxy["render"]>[0];
  await page.render({
    canvasContext: context as unknown as RenderParameters["canvasContext"],
    canvas: canvas as unknown as RenderParameters["canvas"],
    viewport,
  }).promise;
  return canvas.toBuffer("image/png");
}
