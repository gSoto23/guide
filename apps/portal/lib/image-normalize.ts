/**
 * Re-encodes a screenshot in the browser before upload (research R9, FR-009, T061): JPEG, longest
 * side at most 2,560 px. Re-encoding shrinks large photos and drops metadata such as GPS early.
 * Apple browsers decode HEIC, so it converts there; a browser that cannot decode a file (HEIC
 * elsewhere) asks the host for a JPEG or PNG instead. Loaded on demand, so it never weighs on the
 * initial bundle.
 */
export const MAX_SIDE = 2560;
export const MAX_BYTES = 10 * 1024 * 1024;

export type NormalizeResult =
  | { ok: true; blob: Blob; width: number; height: number }
  | { ok: false; reason: "cannot_decode" | "too_large" };

async function decode(file: Blob): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
}

export async function normalizeImage(file: Blob): Promise<NormalizeResult> {
  const bitmap = await decode(file);
  if (!bitmap) return { ok: false, reason: "cannot_decode" };
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return { ok: false, reason: "cannot_decode" };
  }
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  if (blob.size > MAX_BYTES) return { ok: false, reason: "too_large" };
  return { ok: true, blob, width, height };
}
