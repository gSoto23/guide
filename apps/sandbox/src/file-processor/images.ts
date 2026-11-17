import sharp, { type Metadata } from "sharp";

/**
 * Image checks and re-encoding for uploaded screenshots (research R2, R3, R9, SEC-10,
 * AC-SEC-005). The bytes are untrusted: the file name and the declared content type are never
 * read, only the leading magic bytes, and every accepted image is decoded and re-encoded before
 * text recognition, so nothing of the original file but its pixels goes further.
 */

/** The image types the file processor accepts (FR-009). HEIC is converted by the portal (R9). */
export type ImageType = "jpeg" | "png" | "webp";

/** Longest side of the image handed to text recognition, in pixels (research R3). */
export const MAX_IMAGE_SIDE = 2560;

/**
 * Most pixels (width x height) the processor decodes: a guard against decompression bombs, a
 * small file that declares huge dimensions. 50 megapixels holds a long scrolling screenshot
 * (1290 x 30,000 is 38.7 megapixels) with room to spare.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

/**
 * Process-wide `sharp` settings, applied once when this module loads. Only this module uses
 * `sharp` in the processes that load it (the sandbox function, or the worker in development).
 *
 * - libvips may decode only JPEG, PNG, and WebP from memory. Its other decoders (SVG, PDF, TIFF,
 *   GIF, HEIF, and the rest) stay unreachable even if a file got past the magic-byte check.
 * - The operation cache is off, so decoded screenshots are not kept in memory after a request.
 */
export const ALLOWED_DECODERS = [
  "VipsForeignLoadJpegBuffer",
  "VipsForeignLoadPngBuffer",
  "VipsForeignLoadWebpBuffer",
] as const;
sharp.block({ operation: ["VipsForeignLoad"] });
sharp.unblock({ operation: [...ALLOWED_DECODERS] });
sharp.cache(false);

const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

function hasBytes(bytes: Uint8Array, expected: number[], offset = 0): boolean {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

/**
 * The image type given by the file's magic bytes (AC-SEC-005), or null for anything else: a ZIP
 * archive or a script named `.png`, a GIF, an SVG, a PDF, or an empty file.
 *
 * - JPEG: `FF D8 FF`
 * - PNG: `89 50 4E 47 0D 0A 1A 0A`
 * - WebP: `RIFF`, a four-byte size, then `WEBP`
 */
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (hasBytes(bytes, JPEG_SIGNATURE)) return "jpeg";
  if (hasBytes(bytes, PNG_SIGNATURE)) return "png";
  if (hasBytes(bytes, RIFF) && hasBytes(bytes, WEBP, 8)) return "webp";
  return null;
}

export type NormalizedImage =
  { image: Buffer } | { error: "unsupported_type" | "too_large" | "unreadable" };

/**
 * Re-encodes an image whose magic bytes matched `type` (research R3, R9):
 *
 * - turns it upright from its EXIF orientation;
 * - drops every piece of metadata, EXIF and GPS, XMP, IPTC, and the ICC profile included, since
 *   only the pixels are copied to the output;
 * - flattens any transparency onto white, so dark text on a transparent background stays dark;
 * - converts it to one-channel grayscale;
 * - shrinks it, without ever enlarging it, until its longest side is at most 2,560 px;
 * - writes a PNG.
 *
 * The decoder must agree with the magic bytes (`unsupported_type` otherwise). Images over
 * `MAX_INPUT_PIXELS` are refused from their header, before any pixel is decoded (`too_large`).
 * Data `sharp` cannot decode, including a truncated or corrupt file, is `unreadable`.
 */
export async function normalizeImage(bytes: Buffer, type: ImageType): Promise<NormalizedImage> {
  // `failOn: "warning"` is the setting sharp recommends for untrusted input; only the first
  // frame of an animated WebP is read.
  const options = { failOn: "warning", limitInputPixels: MAX_INPUT_PIXELS, pages: 1 } as const;

  let metadata: Metadata;
  try {
    // Only the header is read here, so the pixel limit is checked below, where an oversized
    // image can be told apart from a corrupt one.
    metadata = await sharp(bytes, { ...options, limitInputPixels: false }).metadata();
  } catch {
    return { error: "unreadable" };
  }
  if (metadata.format !== type) return { error: "unsupported_type" };
  if (metadata.width * metadata.height > MAX_INPUT_PIXELS) return { error: "too_large" };

  try {
    // The decoder enforces the same pixel limit, in case the header and the data disagree.
    const image = await sharp(bytes, { ...options, autoOrient: true })
      .flatten({ background: "#ffffff" })
      .resize({
        width: MAX_IMAGE_SIDE,
        height: MAX_IMAGE_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .greyscale()
      .toColourspace("b-w")
      .png()
      .toBuffer();
    return { image };
  } catch {
    return { error: "unreadable" };
  }
}
