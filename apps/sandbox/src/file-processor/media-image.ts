import sharp from "sharp";
import type { FileProcessResponse } from "../protocol.js";
import { detectImageType, MAX_INPUT_PIXELS } from "./images.js";

/** Where cleaned guide media is written: the media bucket in AWS, a folder locally. */
export interface MediaSink {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
}

/** Long side of the two variants (feature 003 research R9). */
const VARIANTS = [
  { name: "large", side: 1600 },
  { name: "small", side: 640 },
] as const;

/** Images kept as guide media: 10 MB at most (FR-009). */
export const MEDIA_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Cleans one guide image (feature 003 research R9, SEC-10, AC-SEC-010): the type is checked by its
 * magic bytes, the orientation is applied, and the image is re-encoded to WebP at 1,600 and 640 px
 * on the long side. Re-encoding drops every metadata block (EXIF, GPS, XMP, ICC comments), so
 * nothing but pixels reaches the media bucket.
 */
export async function processMediaImage(
  bytes: Buffer,
  mediaPrefix: string,
  sink: MediaSink,
): Promise<FileProcessResponse> {
  if (bytes.length > MEDIA_IMAGE_MAX_BYTES) return { error: "too_large" };
  if (detectImageType(bytes) === null) return { error: "unsupported_type" };
  const variants: Record<
    string,
    { key: string; bytes: number; width: number; height: number; contentType: string }
  > = {};
  let total = 0;
  let width = 1;
  let height = 1;
  try {
    for (const variant of VARIANTS) {
      const { data, info } = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({
          width: variant.side,
          height: variant.side,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      const key = `${mediaPrefix}${variant.name}.webp`;
      await sink.put(key, data, "image/webp");
      variants[variant.name] = {
        key,
        bytes: data.length,
        width: info.width,
        height: info.height,
        contentType: "image/webp",
      };
      total += data.length;
      if (variant.name === "large") {
        width = info.width;
        height = info.height;
      }
    }
  } catch {
    return { error: "unreadable" };
  }
  return { media: { kind: "image", variants, bytes: total, width, height } };
}
