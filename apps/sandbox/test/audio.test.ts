import { describe, expect, it } from "vitest";
import { AUDIO_MAX_BYTES, checkAudio } from "../src/file-processor/audio.js";

/**
 * The `audio` mode (feature 003 T083, research R8): voice notes are accepted by their magic
 * bytes, never by their name or declared type. The bytes below are synthetic headers.
 */
function webm(docType = "webm"): Buffer {
  const name = Buffer.from(docType, "latin1");
  return Buffer.concat([
    Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0x82]),
    Buffer.from([0x80 | name.length]),
    name,
    Buffer.alloc(32),
  ]);
}

function mp4(brand: string): Buffer {
  const header = Buffer.alloc(32);
  header.writeUInt32BE(32, 0);
  header.write("ftyp", 4, "latin1");
  header.write(brand, 8, "latin1");
  return header;
}

describe("the audio mode (T083)", () => {
  it("accepts WebM, Ogg, MP4, and M4A by their magic bytes", () => {
    expect(checkAudio(webm())).toEqual({ audio: { container: "webm" } });
    expect(checkAudio(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(40)]))).toEqual({
      audio: { container: "ogg" },
    });
    expect(checkAudio(mp4("isom"))).toEqual({ audio: { container: "mp4" } });
    expect(checkAudio(mp4("M4A "))).toEqual({ audio: { container: "mp4" } });
  });

  it("refuses anything else as unsupported_type", () => {
    expect(checkAudio(webm("matroska"))).toEqual({ error: "unsupported_type" });
    expect(checkAudio(Buffer.from("%PDF-1.7 not audio at all"))).toEqual({
      error: "unsupported_type",
    });
    expect(
      checkAudio(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40)])),
    ).toEqual({ error: "unsupported_type" });
    expect(checkAudio(Buffer.from("tiny"))).toEqual({ error: "unsupported_type" });
  });

  it("refuses a voice note over 10 MB", () => {
    const big = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(AUDIO_MAX_BYTES)]);
    expect(checkAudio(big)).toEqual({ error: "too_large" });
  });
});

describe("the file processor in audio mode", () => {
  function memory(bytes: Buffer) {
    const deleted: string[] = [];
    return {
      deleted,
      storage: {
        get: async () => bytes,
        delete: async (key: string) => {
          deleted.push(key);
        },
      },
    };
  }
  const objectKey =
    "uploads/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002";

  it("keeps a voice note that passes for the transcription, and deletes one that fails", async () => {
    const { createFileProcessor } = await import("../src/file-processor/handler.js");
    const recognizer = { recognize: async () => "" };
    const good = memory(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(40)]));
    const keep = createFileProcessor({ storage: good.storage, recognizer });
    expect(await keep({ objectKey, purpose: "audio" })).toEqual({ audio: { container: "ogg" } });
    expect(good.deleted).toEqual([]);

    const bad = memory(Buffer.from("%PDF-1.7 not audio at all"));
    const reject = createFileProcessor({ storage: bad.storage, recognizer });
    expect(await reject({ objectKey, purpose: "audio" })).toEqual({ error: "unsupported_type" });
    expect(bad.deleted).toEqual([objectKey]);
  });
});
