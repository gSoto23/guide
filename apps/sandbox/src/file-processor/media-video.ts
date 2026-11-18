import type { FileProcessResponse } from "../protocol.js";
import type { MediaSink } from "./media-image.js";

/**
 * Cleans one guide video (feature 003 research R9, SEC-10): MP4 or QuickTime only, checked by the
 * `ftyp` box; at most 90 seconds (FR-009); H.264 or HEVC. Metadata boxes (`udta`, `meta`, and XMP
 * `uuid`, which hold the recording's location and device) are renamed `free` and zero-filled in
 * place, so no offset moves and the video plays as before. Nothing is re-encoded.
 */
export const MEDIA_VIDEO_MAX_BYTES = 150 * 1024 * 1024;
export const MEDIA_VIDEO_MAX_DURATION_MS = 90_000;

const CONTAINERS = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "dinf"]);
/** Boxes neutralized wherever they appear inside these parents ("" is the file's top level). */
const METADATA: Record<string, readonly string[]> = {
  "": ["udta", "meta", "uuid"],
  moov: ["udta", "meta", "uuid"],
  trak: ["udta", "meta", "uuid"],
  mdia: ["udta", "meta"],
};
const QUICKTIME_BRANDS = new Set(["qt  "]);

interface Box {
  type: string;
  start: number;
  headerSize: number;
  end: number;
}

class Malformed extends Error {}

function readBoxes(bytes: Buffer, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let offset = from;
  while (offset + 8 <= to) {
    let size = bytes.readUInt32BE(offset);
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > to) throw new Malformed();
      const large = bytes.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) throw new Malformed();
      size = Number(large);
      headerSize = 16;
    } else if (size === 0) {
      size = to - offset;
    }
    if (size < headerSize || offset + size > to) throw new Malformed();
    boxes.push({ type, start: offset, headerSize, end: offset + size });
    offset += size;
  }
  return boxes;
}

interface Findings {
  durationMs: number | null;
  codec: "h264" | "hevc" | null;
  width: number | null;
  height: number | null;
}

function neutralize(bytes: Buffer, box: Box): void {
  bytes.write("free", box.start + 4, "latin1");
  bytes.fill(0, box.start + box.headerSize, box.end);
}

function readMvhd(bytes: Buffer, box: Box): number | null {
  const at = box.start + box.headerSize;
  const version = bytes.readUInt8(at);
  if (version === 1) {
    const timescale = bytes.readUInt32BE(at + 20);
    const duration = Number(bytes.readBigUInt64BE(at + 24));
    return timescale > 0 ? Math.round((duration / timescale) * 1000) : null;
  }
  const timescale = bytes.readUInt32BE(at + 12);
  const duration = bytes.readUInt32BE(at + 16);
  return timescale > 0 ? Math.round((duration / timescale) * 1000) : null;
}

function readStsd(bytes: Buffer, box: Box, findings: Findings): void {
  const entries = readBoxes(bytes, box.start + box.headerSize + 8, box.end);
  for (const entry of entries) {
    const codec =
      entry.type === "avc1" || entry.type === "avc3"
        ? "h264"
        : entry.type === "hvc1" || entry.type === "hev1"
          ? "hevc"
          : null;
    if (codec && !findings.codec) {
      findings.codec = codec;
      // VisualSampleEntry: 6 reserved, 2 data reference index, 16 pre-defined, then width, height.
      const at = entry.start + entry.headerSize + 24;
      if (at + 4 <= entry.end) {
        findings.width = bytes.readUInt16BE(at) || null;
        findings.height = bytes.readUInt16BE(at + 2) || null;
      }
    }
  }
}

function walk(bytes: Buffer, from: number, to: number, parent: string, findings: Findings): void {
  for (const box of readBoxes(bytes, from, to)) {
    if ((METADATA[parent] ?? []).includes(box.type)) {
      neutralize(bytes, box);
    } else if (box.type === "mvhd" && parent === "moov") {
      findings.durationMs = readMvhd(bytes, box);
    } else if (box.type === "stsd") {
      readStsd(bytes, box, findings);
    } else if (CONTAINERS.has(box.type)) {
      walk(bytes, box.start + box.headerSize, box.end, box.type, findings);
    }
  }
}

export async function processMediaVideo(
  input: Buffer,
  mediaPrefix: string,
  sink: MediaSink,
): Promise<FileProcessResponse> {
  if (input.length > MEDIA_VIDEO_MAX_BYTES) return { error: "too_large" };
  if (input.length < 16 || input.toString("latin1", 4, 8) !== "ftyp")
    return { error: "unsupported_type" };
  const bytes = Buffer.from(input);
  const findings: Findings = { durationMs: null, codec: null, width: null, height: null };
  let quicktime: boolean;
  try {
    quicktime = QUICKTIME_BRANDS.has(bytes.toString("latin1", 8, 12));
    walk(bytes, 0, bytes.length, "", findings);
  } catch (error: unknown) {
    if (error instanceof Malformed || error instanceof RangeError) return { error: "unreadable" };
    throw error;
  }
  if (findings.durationMs === null) return { error: "unreadable" };
  if (findings.durationMs > MEDIA_VIDEO_MAX_DURATION_MS) return { error: "too_long" };
  if (!findings.codec) return { error: "unsupported_codec" };
  const extension = quicktime ? "mov" : "mp4";
  const contentType = quicktime ? "video/quicktime" : "video/mp4";
  const key = `${mediaPrefix}original.${extension}`;
  await sink.put(key, bytes, contentType);
  return {
    media: {
      kind: "video",
      variants: { original: { key, bytes: bytes.length, contentType } },
      bytes: bytes.length,
      durationMs: findings.durationMs,
      codec: findings.codec,
      ...(findings.width ? { width: findings.width } : {}),
      ...(findings.height ? { height: findings.height } : {}),
    },
  };
}
