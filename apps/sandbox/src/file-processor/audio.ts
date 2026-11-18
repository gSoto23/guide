import type { FileProcessResponse } from "@guidesk/integrations/sandbox-protocol";

/** The largest voice note (feature 003 research R8: 2 minutes, at most 10 MB). */
export const AUDIO_MAX_BYTES = 10 * 1024 * 1024;

/** Containers that may carry a WebM document type (EBML, research R8). */
function ebmlDocType(bytes: Buffer): string | null {
  if (bytes.length < 4 || bytes.readUInt32BE(0) !== 0x1a45dfa3) return null;
  // The DocType element (0x42 0x82) sits in the first header; read its short string value.
  const head = bytes.subarray(0, Math.min(bytes.length, 64));
  const at = head.indexOf(Buffer.from([0x42, 0x82]));
  if (at === -1 || at + 3 > head.length) return null;
  const size = head[at + 2]! & 0x7f;
  return head.subarray(at + 3, at + 3 + size).toString("latin1");
}

/**
 * The `audio` mode of the file processor (feature 003 T088, research R8): a voice note is checked
 * by its magic bytes and its size only. WebM, Ogg, MP4, and M4A (an MP4 brand) are accepted, and
 * WAV for tests; anything else is `unsupported_type`. The audio itself is left in the uploads
 * bucket for the transcription, which deletes it (FR-037).
 */
export function checkAudio(bytes: Buffer, maxBytes = AUDIO_MAX_BYTES): FileProcessResponse {
  if (bytes.length > maxBytes) return { error: "too_large" };
  if (bytes.length < 12) return { error: "unsupported_type" };
  if (ebmlDocType(bytes) === "webm") return { audio: { container: "webm" } };
  if (bytes.subarray(0, 4).toString("latin1") === "OggS") return { audio: { container: "ogg" } };
  if (bytes.subarray(4, 8).toString("latin1") === "ftyp") return { audio: { container: "mp4" } };
  if (
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WAVE"
  ) {
    return { audio: { container: "wav" } };
  }
  return { error: "unsupported_type" };
}
