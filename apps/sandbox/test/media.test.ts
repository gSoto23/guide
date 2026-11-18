import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { processMediaImage } from "../src/file-processor/media-image.js";
import { processMediaVideo } from "../src/file-processor/media-video.js";

/**
 * Guide media in the file processor (feature 003 T042, research R9, AC-SEC-010): images are
 * re-encoded without metadata, and videos lose their metadata boxes in place.
 */
const prefix = `media/${randomUUID()}/${randomUUID()}/`;

function memorySink() {
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  return {
    objects,
    put: async (key: string, bytes: Buffer, contentType: string) => {
      objects.set(key, { bytes, contentType });
    },
  };
}

function box(type: string, ...children: Buffer[]): Buffer {
  const body = Buffer.concat(children);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "latin1");
  return Buffer.concat([header, body]);
}

function mvhd(timescale: number, duration: number): Buffer {
  const body = Buffer.alloc(100);
  body.writeUInt32BE(timescale, 12);
  body.writeUInt32BE(duration, 16);
  return box("mvhd", body);
}

function sampleEntry(type: string, width: number, height: number): Buffer {
  const body = Buffer.alloc(70);
  body.writeUInt16BE(width, 24);
  body.writeUInt16BE(height, 26);
  return box(type, body);
}

function stsd(entry: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(1, 4);
  return box("stsd", header, entry);
}

/** A synthetic MP4 or MOV with a location box, enough for the parser (not playable). */
function video(options: { brand?: string; seconds?: number; codec?: string } = {}): Buffer {
  const brand = Buffer.from((options.brand ?? "isom").padEnd(4).slice(0, 4), "latin1");
  const location = box("©xyz", Buffer.from("+09.8800-085.6700/", "latin1"));
  const moov = box(
    "moov",
    mvhd(600, (options.seconds ?? 40) * 600),
    box(
      "trak",
      box("mdia", box("minf", box("stbl", stsd(sampleEntry(options.codec ?? "avc1", 1920, 1080))))),
      box("udta", location),
    ),
    box("udta", location),
    box("meta", Buffer.from("com.apple.quicktime.location.ISO6709", "latin1")),
  );
  return Buffer.concat([
    box("ftyp", brand, Buffer.alloc(4)),
    moov,
    box("mdat", Buffer.alloc(64, 7)),
  ]);
}

describe("media images", () => {
  it("re-encodes a JPEG with GPS into WebP variants without any metadata", async () => {
    const input = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .jpeg()
      .withExif({
        IFD0: { Make: "TestCam" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "9/1 52/1 0/1" },
      })
      .toBuffer();
    expect((await sharp(input).metadata()).exif?.toString("hex")).toContain("2588");
    const sink = memorySink();
    const result = await processMediaImage(input, prefix, sink);
    expect(result).toMatchObject({ media: { kind: "image", width: 1600, height: 1067 } });
    expect([...sink.objects.keys()]).toEqual([`${prefix}large.webp`, `${prefix}small.webp`]);
    for (const object of sink.objects.values()) {
      const meta = await sharp(object.bytes).metadata();
      expect(meta.format).toBe("webp");
      expect(meta.exif).toBeUndefined();
      expect(object.contentType).toBe("image/webp");
    }
    expect((await sharp(sink.objects.get(`${prefix}small.webp`)!.bytes).metadata()).width).toBe(
      640,
    );
  });

  it("refuses a file that is not an image by its content (AC-SEC-009)", async () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    expect(await processMediaImage(zip, prefix, memorySink())).toEqual({
      error: "unsupported_type",
    });
  });
});

describe("media videos", () => {
  it("zero-fills the metadata boxes in place and keeps every other byte", async () => {
    const input = video();
    const sink = memorySink();
    const result = await processMediaVideo(input, prefix, sink);
    expect(result).toMatchObject({
      media: {
        kind: "video",
        durationMs: 40_000,
        codec: "h264",
        width: 1920,
        height: 1080,
        bytes: input.length,
      },
    });
    const stored = sink.objects.get(`${prefix}original.mp4`)!;
    expect(stored.contentType).toBe("video/mp4");
    expect(stored.bytes.length).toBe(input.length);
    const text = stored.bytes.toString("latin1");
    expect(text).not.toContain("+09.8800");
    expect(text).not.toContain("com.apple.quicktime.location");
    expect(text).not.toContain("udta");
    expect(text).toContain("free");
    let changed = 0;
    for (let index = 0; index < input.length; index += 1)
      if (input[index] !== stored.bytes[index]) changed += 1;
    expect(changed).toBeGreaterThan(0);
    expect(stored.bytes.subarray(stored.bytes.length - 64)).toEqual(
      input.subarray(input.length - 64),
    );
  });

  it("stores QuickTime files as MOV and reports HEVC", async () => {
    const sink = memorySink();
    const result = await processMediaVideo(video({ brand: "qt", codec: "hvc1" }), prefix, sink);
    expect(result).toMatchObject({ media: { codec: "hevc" } });
    expect(sink.objects.get(`${prefix}original.mov`)?.contentType).toBe("video/quicktime");
  });

  it("refuses videos over 90 seconds, unknown codecs, and files that are not MP4 or MOV", async () => {
    expect(await processMediaVideo(video({ seconds: 91 }), prefix, memorySink())).toEqual({
      error: "too_long",
    });
    expect(await processMediaVideo(video({ codec: "vp09" }), prefix, memorySink())).toEqual({
      error: "unsupported_codec",
    });
    expect(
      await processMediaVideo(Buffer.from("not a video at all, really"), prefix, memorySink()),
    ).toEqual({
      error: "unsupported_type",
    });
    const truncated = video().subarray(0, 60);
    expect(await processMediaVideo(truncated, prefix, memorySink())).toEqual({
      error: "unreadable",
    });
  });
});
