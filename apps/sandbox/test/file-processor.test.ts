import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  S3ServiceException,
  type S3Client,
} from "@aws-sdk/client-s3";
import sharp from "sharp";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { UnreadableImageError, type TextRecognitionPort } from "@guidesk/integrations/ocr-port";
import {
  FILE_MAX_BYTES,
  createFileProcessor,
  type ObjectSource,
} from "../src/file-processor/handler.js";
import {
  ALLOWED_DECODERS,
  MAX_IMAGE_SIDE,
  MAX_INPUT_PIXELS,
  detectImageType,
  normalizeImage,
} from "../src/file-processor/images.js";
import {
  RECOGNITION_LANGUAGES,
  TesseractRecognizer,
  type CreateTesseractWorker,
} from "../src/file-processor/ocr.js";
import { S3ObjectSource } from "../src/file-processor/s3-source.js";
import { instrumentHandler } from "../src/observability.js";
import { FILE_MAX_TEXT_LENGTH } from "../src/protocol.js";

const KEY = "uploads/0b5c7a52-3f1e-4c8e-9a51-6d2f0e7b9c10/7e4d2a91-5b6c-4f3a-8e2d-1c9b0a7f6e54";
const SCREENSHOT = { objectKey: KEY, purpose: "screenshot" } as const;
const FIXTURES = join(import.meta.dirname, "fixtures", "screenshots");

/** In-memory uploads bucket that records reads and deletes. */
class MemoryStorage implements ObjectSource {
  readonly objects = new Map<string, Buffer>();
  readonly deleted: string[] = [];
  reads = 0;
  failDelete = false;

  constructor(objects: Record<string, Buffer> = {}) {
    for (const [key, bytes] of Object.entries(objects)) this.objects.set(key, bytes);
  }

  async get(key: string): Promise<Buffer | null> {
    this.reads += 1;
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error("delete failed");
    this.deleted.push(key);
    this.objects.delete(key);
  }
}

type Recognize = TextRecognitionPort["recognize"];

/** A recognizer that answers with `answer` and records the images it receives. */
function fakeRecognizer(answer: string | Error | Recognize): {
  recognizer: TextRecognitionPort;
  images: Buffer[];
} {
  const images: Buffer[] = [];
  return {
    images,
    recognizer: {
      recognize: async (image, options) => {
        images.push(image);
        if (typeof answer === "function") return answer(image, options);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

function solid(width: number, height: number, channels: 3 | 4 = 3) {
  return sharp({
    create: { width, height, channels, background: { r: 200, g: 120, b: 40, alpha: 1 } },
  });
}

/** A PNG whose header declares `width` x `height` pixels but holds no image data. */
function pngHeaderOnly(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // 8-bit grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.alloc(0))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const ZIP = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00]),
  Buffer.from("synthetic-archive-entry.txt"),
]);
const SCRIPT_NAMED_PNG = Buffer.from("#!/bin/sh\necho 'synthetic script saved as photo.png'\n");
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>');
const CORRUPT_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from("not a jpeg")]);

describe("magic bytes (AC-SEC-005)", () => {
  it.each([
    ["jpeg", () => solid(32, 24).jpeg().toBuffer()],
    ["png", () => solid(32, 24).png().toBuffer()],
    ["webp", () => solid(32, 24).webp().toBuffer()],
  ] as const)("accepts %s by its content", async (type, make) => {
    expect(detectImageType(await make())).toBe(type);
  });

  it.each([
    ["a ZIP archive", ZIP],
    ["a script named .png", SCRIPT_NAMED_PNG],
    ["an SVG", SVG],
    ["a PDF", Buffer.from("%PDF-1.7\n%synthetic\n")],
    ["a RIFF file that is not WebP", Buffer.from("RIFF\x24\x00\x00\x00WAVEfmt ", "latin1")],
    ["a cut PNG signature", Buffer.from([0x89, 0x50, 0x4e, 0x47])],
    ["an empty file", Buffer.alloc(0)],
  ])("rejects %s", (_name, bytes) => {
    expect(detectImageType(bytes)).toBeNull();
  });

  it("rejects a GIF, which sharp could decode", async () => {
    expect(detectImageType(await solid(8, 8).gif().toBuffer())).toBeNull();
  });

  it.each([
    ["a ZIP archive", ZIP],
    ["a script named .png", SCRIPT_NAMED_PNG],
  ])("answers unsupported_type for %s and deletes it unread", async (_name, bytes) => {
    const storage = new MemoryStorage({ [KEY]: bytes });
    const { recognizer, images } = fakeRecognizer("never");
    const processFile = createFileProcessor({ storage, recognizer });

    expect(await processFile(SCREENSHOT)).toEqual({ error: "unsupported_type" });
    expect(storage.deleted).toEqual([KEY]);
    expect(images).toHaveLength(0);
  });

  it("lets libvips decode only JPEG, PNG, and WebP, whatever the magic bytes say", async () => {
    expect(ALLOWED_DECODERS).toEqual([
      "VipsForeignLoadJpegBuffer",
      "VipsForeignLoadPngBuffer",
      "VipsForeignLoadWebpBuffer",
    ]);
    await expect(sharp(SVG).metadata()).rejects.toThrow();
    await expect(sharp(await solid(8, 8).gif().toBuffer()).metadata()).rejects.toThrow();
    await expect(sharp(await solid(8, 8).tiff().toBuffer()).metadata()).rejects.toThrow();
  });
});

describe("re-encoding (research R3, R9)", () => {
  it("strips EXIF, GPS, and ICC data and gives an upright grayscale PNG of at most 2,560 px", async () => {
    // 3000 x 4000 stored sideways (orientation 6): upright, it is 4000 x 3000.
    const photo = await solid(3000, 4000)
      .withMetadata({ orientation: 6 })
      .withExif({
        IFD0: { Make: "SyntheticCam", Model: "Fixture One" },
        IFD3: { GPSLatitudeRef: "N", GPSLatitude: "9/1 56/1 0/1" },
      })
      .withIccProfile("p3")
      .jpeg()
      .toBuffer();
    const input = await sharp(photo).metadata();
    expect(input.orientation).toBe(6);
    expect(input.exif?.includes("SyntheticCam")).toBe(true);
    // The GPS IFD pointer (tag 0x8825, little-endian) is present.
    expect(input.exif?.includes(Buffer.from([0x25, 0x88]))).toBe(true);
    expect(input.icc).toBeDefined();

    const normalized = await normalizeImage(photo, "jpeg");
    if (!("image" in normalized)) throw new Error(`expected an image, got ${normalized.error}`);
    const output = await sharp(normalized.image).metadata();

    expect(output.format).toBe("png");
    expect(output.channels).toBe(1);
    expect(output.space).toBe("b-w");
    expect([output.width, output.height]).toEqual([MAX_IMAGE_SIDE, 1920]);
    expect(output.exif).toBeUndefined();
    expect(output.icc).toBeUndefined();
    expect(output.xmp).toBeUndefined();
    expect(output.iptc).toBeUndefined();
    expect(output.orientation).toBeUndefined();
    expect(normalized.image.includes("Exif")).toBe(false);
    expect(normalized.image.includes("SyntheticCam")).toBe(false);
    // Re-encoding a 12-megapixel photo can pass 5 s on shared CI runners.
  }, 30_000);

  it("shrinks a tall screenshot to a longest side of 2,560 px", async () => {
    const tall = await solid(1000, 6000).png().toBuffer();
    const normalized = await normalizeImage(tall, "png");
    if (!("image" in normalized)) throw new Error("expected an image");
    const { width, height } = await sharp(normalized.image).metadata();
    expect(height).toBe(MAX_IMAGE_SIDE);
    expect(Math.abs(width - 427)).toBeLessThanOrEqual(1);
  });

  it("never enlarges a small image", async () => {
    const small = await solid(400, 300).webp().toBuffer();
    const normalized = await normalizeImage(small, "webp");
    if (!("image" in normalized)) throw new Error("expected an image");
    const { width, height, format } = await sharp(normalized.image).metadata();
    expect([width, height, format]).toEqual([400, 300, "png"]);
  });

  it("flattens transparency onto white", async () => {
    const transparent = await sharp({
      create: { width: 8, height: 8, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const normalized = await normalizeImage(transparent, "png");
    if (!("image" in normalized)) throw new Error("expected an image");
    const pixels = await sharp(normalized.image).raw().toBuffer();
    expect(pixels.every((value) => value === 255)).toBe(true);
  });

  it("refuses a decompression bomb from its header, before decoding", async () => {
    const bomb = pngHeaderOnly(20_000, 20_000);
    expect(20_000 * 20_000).toBeGreaterThan(MAX_INPUT_PIXELS);
    expect(await normalizeImage(bomb, "png")).toEqual({ error: "too_large" });
  });

  it("answers unreadable for corrupt or truncated data", async () => {
    const jpeg = await solid(200, 200).jpeg().toBuffer();
    expect(await normalizeImage(CORRUPT_JPEG, "jpeg")).toEqual({ error: "unreadable" });
    expect(await normalizeImage(jpeg.subarray(0, 300), "jpeg")).toEqual({ error: "unreadable" });
  });

  it("answers unsupported_type when the decoder disagrees with the magic bytes", async () => {
    const png = await solid(16, 16).png().toBuffer();
    expect(await normalizeImage(png, "jpeg")).toEqual({ error: "unsupported_type" });
  });
});

describe("createFileProcessor (FR-015)", () => {
  async function screenshotPng(): Promise<Buffer> {
    return solid(120, 80).png().toBuffer();
  }

  it("returns the recognized text and deletes the object", async () => {
    const storage = new MemoryStorage({ [KEY]: await screenshotPng() });
    const { recognizer, images } = fakeRecognizer("  Door code 4821\nWi-Fi\n");
    const processFile = createFileProcessor({ storage, recognizer });

    expect(await processFile(SCREENSHOT)).toEqual({ text: "Door code 4821\nWi-Fi" });
    expect(storage.deleted).toEqual([KEY]);
    expect(storage.objects.size).toBe(0);
    // The recognizer gets the re-encoded grayscale PNG, never the uploaded bytes.
    expect(images).toHaveLength(1);
    expect(detectImageType(images[0] ?? Buffer.alloc(0))).toBe("png");
    expect((await sharp(images[0]).metadata()).channels).toBe(1);
  });

  it.each([
    ["an archive", () => Promise.resolve(ZIP), "fine", { error: "unsupported_type" }],
    [
      "a file over 10 MB",
      async () => {
        const big = Buffer.alloc(FILE_MAX_BYTES + 1);
        (await screenshotPng()).copy(big);
        return big;
      },
      "fine",
      { error: "too_large" },
    ],
    [
      "a decompression bomb",
      () => Promise.resolve(pngHeaderOnly(20_000, 20_000)),
      "fine",
      { error: "too_large" },
    ],
    ["a corrupt image", () => Promise.resolve(CORRUPT_JPEG), "fine", { error: "unreadable" }],
    [
      "an image the engine cannot read",
      screenshotPng,
      new UnreadableImageError(),
      { error: "unreadable" },
    ],
    ["an image with no text", screenshotPng, " \n\n ", { error: "unreadable" }],
  ] as const)("deletes the object after %s", async (_name, make, answer, expected) => {
    const storage = new MemoryStorage({ [KEY]: await make() });
    const processFile = createFileProcessor({
      storage,
      recognizer: fakeRecognizer(answer).recognizer,
    });

    expect(await processFile(SCREENSHOT)).toEqual(expected);
    expect(storage.deleted).toEqual([KEY]);
  });

  it("deletes the object when recognition fails unexpectedly, then rethrows", async () => {
    const storage = new MemoryStorage({ [KEY]: await screenshotPng() });
    const processFile = createFileProcessor({
      storage,
      recognizer: fakeRecognizer(new Error("engine crashed")).recognizer,
    });

    await expect(processFile(SCREENSHOT)).rejects.toThrow("engine crashed");
    expect(storage.deleted).toEqual([KEY]);
  });

  it("stops recognition at the time limit, answers unreadable, and deletes the object", async () => {
    const storage = new MemoryStorage({ [KEY]: await screenshotPng() });
    let received: AbortSignal | undefined;
    const { recognizer } = fakeRecognizer(
      (_image, options) =>
        new Promise<string>((_, reject) => {
          received = options?.signal;
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
        }),
    );
    const processFile = createFileProcessor({ storage, recognizer, recognitionTimeoutMs: 20 });

    expect(await processFile(SCREENSHOT)).toEqual({ error: "unreadable" });
    expect(received?.aborted).toBe(true);
    expect(storage.deleted).toEqual([KEY]);
  });

  it("answers not_found for a missing object and deletes nothing", async () => {
    const storage = new MemoryStorage();
    const processFile = createFileProcessor({
      storage,
      recognizer: fakeRecognizer("x").recognizer,
    });

    expect(await processFile(SCREENSHOT)).toEqual({ error: "not_found" });
    expect(storage.deleted).toEqual([]);
  });

  it.each([
    ["a key outside uploads/", { objectKey: "secrets/../uploads/a/b", purpose: "screenshot" }],
    ["an unknown purpose", { objectKey: KEY, purpose: "pdf" }],
    ["an extra field", { ...SCREENSHOT, url: "https://example.test/listing" }],
  ])("answers internal for %s without touching storage", async (_name, request) => {
    const storage = new MemoryStorage({ [KEY]: await screenshotPng() });
    const processFile = createFileProcessor({
      storage,
      recognizer: fakeRecognizer("x").recognizer,
    });

    expect(await processFile(request as never)).toEqual({ error: "internal" });
    expect(storage.reads).toBe(0);
    expect(storage.deleted).toEqual([]);
  });

  it("honors a smaller size limit", async () => {
    const png = await screenshotPng();
    const storage = new MemoryStorage({ [KEY]: png });
    const processFile = createFileProcessor({
      storage,
      recognizer: fakeRecognizer("x").recognizer,
      maxBytes: png.length - 1,
    });
    expect(await processFile(SCREENSHOT)).toEqual({ error: "too_large" });
  });

  it("cuts the text at the protocol limit without splitting a character", async () => {
    const long = `${"a".repeat(FILE_MAX_TEXT_LENGTH - 1)}😀 and more`;
    const storage = new MemoryStorage({ [KEY]: await screenshotPng() });
    const processFile = createFileProcessor({
      storage,
      recognizer: fakeRecognizer(long).recognizer,
    });

    const result = await processFile(SCREENSHOT);
    if (!("text" in result)) throw new Error("expected text");
    expect(result.text).toBe("a".repeat(FILE_MAX_TEXT_LENGTH - 1));
  });

  it("returns no result when the object cannot be deleted", async () => {
    const storage = new MemoryStorage({ [KEY]: await screenshotPng() });
    storage.failDelete = true;
    const processFile = createFileProcessor({
      storage,
      recognizer: fakeRecognizer("ok").recognizer,
    });

    await expect(processFile(SCREENSHOT)).rejects.toThrow("delete failed");
  });

  it("never logs the recognized text", async () => {
    const lines: string[] = [];
    const storage = new MemoryStorage({ [KEY]: await screenshotPng() });
    const processFile = createFileProcessor({
      storage,
      recognizer: fakeRecognizer("Door code 4821, Wi-Fi password Colibri2026").recognizer,
    });
    const handler = instrumentHandler("file-processor", processFile, {
      write: (text) => lines.push(text),
    });

    const result = await handler(SCREENSHOT, { awsRequestId: "req-ocr" });

    expect(result).toEqual({ text: "Door code 4821, Wi-Fi password Colibri2026" });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ requestId: "req-ocr", outcome: "ok" });
    expect(lines.join("")).not.toContain("4821");
    expect(lines.join("")).not.toContain("Colibri2026");
  });
});

describe("S3ObjectSource (research R9)", () => {
  function stubClient(answer: (command: unknown) => unknown): {
    client: S3Client;
    commands: unknown[];
  } {
    const commands: unknown[] = [];
    const client = {
      send: async (command: unknown) => {
        commands.push(command);
        return answer(command);
      },
    } as unknown as S3Client;
    return { client, commands };
  }

  const s3Error = (name: string, status: number) =>
    new S3ServiceException({ name, $fault: "client", $metadata: { httpStatusCode: status } });

  it("reads at most one byte over the limit with a range request", async () => {
    const { client, commands } = stubClient(() => ({
      Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) },
    }));
    const source = new S3ObjectSource({
      bucket: "uploads-bucket",
      maxBytes: FILE_MAX_BYTES,
      client,
    });

    expect(await source.get(KEY)).toEqual(Buffer.from([1, 2, 3]));
    const command = commands[0];
    expect(command).toBeInstanceOf(GetObjectCommand);
    expect((command as GetObjectCommand).input).toEqual({
      Bucket: "uploads-bucket",
      Key: KEY,
      Range: `bytes=0-${FILE_MAX_BYTES}`,
    });
  });

  it.each([
    ["NoSuchKey", new NoSuchKey({ message: "missing", $metadata: { httpStatusCode: 404 } })],
    // Without s3:ListBucket, S3 answers 403 for a key that does not exist.
    ["AccessDenied", s3Error("AccessDenied", 403)],
  ])("treats %s as a missing object", async (_name, error) => {
    const { client } = stubClient(() => {
      throw error;
    });
    const source = new S3ObjectSource({ bucket: "b", maxBytes: 10, client });
    expect(await source.get(KEY)).toBeNull();
  });

  it("returns an empty buffer for an empty object", async () => {
    const { client } = stubClient(() => {
      throw s3Error("InvalidRange", 416);
    });
    const source = new S3ObjectSource({ bucket: "b", maxBytes: 10, client });
    expect(await source.get(KEY)).toEqual(Buffer.alloc(0));
  });

  it("fails on any other error", async () => {
    const { client } = stubClient(() => {
      throw s3Error("SlowDown", 503);
    });
    const source = new S3ObjectSource({ bucket: "b", maxBytes: 10, client });
    await expect(source.get(KEY)).rejects.toThrow("Could not read the uploaded object");
  });

  it("deletes the object", async () => {
    const { client, commands } = stubClient(() => ({}));
    await new S3ObjectSource({ bucket: "b", maxBytes: 10, client }).delete(KEY);
    expect(commands[0]).toBeInstanceOf(DeleteObjectCommand);
    expect((commands[0] as DeleteObjectCommand).input).toEqual({ Bucket: "b", Key: KEY });
  });
});

describe("TesseractRecognizer without network (research R3)", () => {
  interface Created {
    langs: string;
    oem: number;
    options: Record<string, unknown>;
  }

  /** A stand-in for Tesseract's `createWorker` that records its arguments. */
  function fakeTesseract(recognize: () => Promise<{ data: { text: string } }>): {
    createWorker: CreateTesseractWorker;
    created: Created[];
    terminated: number[];
  } {
    const created: Created[] = [];
    const terminated: number[] = [];
    const createWorker = (async (langs: string, oem: number, options: Record<string, unknown>) => {
      const index = created.push({ langs, oem, options }) - 1;
      return {
        recognize,
        terminate: async () => {
          terminated.push(index);
          return { jobId: "t", data: null };
        },
      };
    }) as unknown as CreateTesseractWorker;
    return { createWorker, created, terminated };
  }

  const answer = (text: string) => async () => ({ data: { text } });
  const image = Buffer.from("image");

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("starts Tesseract with local models only: no CDN, worker, or core URL", async () => {
    vi.stubEnv("TESSERACT_LANG_PATH", "");
    const tesseract = fakeTesseract(answer("text"));
    const recognizer = new TesseractRecognizer({ createWorker: tesseract.createWorker });

    expect(await recognizer.recognize(image)).toBe("text");

    const [call] = tesseract.created;
    if (!call) throw new Error("createWorker was not called");
    expect(call.langs).toBe("spa+eng");
    expect(call.oem).toBe(1); // LSTM only, as the bundled best_int models require
    // Exactly these options: no `workerPath`, `corePath`, or `dataPath`, and no URL anywhere.
    expect(Object.keys(call.options).sort()).toEqual([
      "cachePath",
      "errorHandler",
      "gzip",
      "langPath",
      "logger",
    ]);
    expect(call.options.gzip).toBe(true);
    const langPath = String(call.options.langPath);
    expect(isAbsolute(langPath)).toBe(true);
    expect(langPath).not.toMatch(/^[a-z][a-z\d+.-]*:/i);
    for (const lang of RECOGNITION_LANGUAGES) {
      expect((await stat(join(langPath, `${lang}.traineddata.gz`))).isFile()).toBe(true);
    }
    expect(String(call.options.cachePath).startsWith(tmpdir())).toBe(true);
    await recognizer.terminate();
  });

  it("reads the models from TESSERACT_LANG_PATH under the Lambda task root", async () => {
    const root = await mkdtemp(join(tmpdir(), "guidesk-task-"));
    try {
      // The same layout as the function bundle: `lang/*.traineddata.gz` (infra/sandbox.ts).
      await mkdir(join(root, "lang"));
      const require = createRequire(import.meta.url);
      for (const lang of RECOGNITION_LANGUAGES) {
        const data = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
        await copyFile(
          join(data, "4.0.0_best_int", `${lang}.traineddata.gz`),
          join(root, "lang", `${lang}.traineddata.gz`),
        );
      }
      vi.stubEnv("TESSERACT_LANG_PATH", "lang");
      vi.stubEnv("LAMBDA_TASK_ROOT", root);
      const tesseract = fakeTesseract(answer("x"));
      await new TesseractRecognizer({ createWorker: tesseract.createWorker }).recognize(image);
      expect(tesseract.created[0]?.options.langPath).toBe(join(root, "lang"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses a URL as the language folder", async () => {
    const tesseract = fakeTesseract(answer("x"));
    const recognizer = new TesseractRecognizer({
      langPath: "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int",
      createWorker: tesseract.createWorker,
    });
    await expect(recognizer.recognize(image)).rejects.toThrow("local path");
    expect(tesseract.created).toHaveLength(0);
  });

  it("refuses to start when a model is missing instead of downloading it", async () => {
    const empty = await mkdtemp(join(tmpdir(), "guidesk-no-models-"));
    try {
      const tesseract = fakeTesseract(answer("x"));
      const recognizer = new TesseractRecognizer({
        langPath: empty,
        createWorker: tesseract.createWorker,
      });
      await expect(recognizer.recognize(image)).rejects.toThrow("never downloaded");
      expect(tesseract.created).toHaveLength(0);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it("reuses one worker across calls and terminates it", async () => {
    const tesseract = fakeTesseract(answer("x"));
    const recognizer = new TesseractRecognizer({ createWorker: tesseract.createWorker });

    await recognizer.recognize(image);
    await recognizer.recognize(image);
    expect(tesseract.created).toHaveLength(1);

    await recognizer.terminate();
    expect(tesseract.terminated).toEqual([0]);
    await recognizer.recognize(image);
    expect(tesseract.created).toHaveLength(2);
    await recognizer.terminate();
  });

  it("terminates a worker stuck on an aborted image and starts a new one", async () => {
    let calls = 0;
    const controller = new AbortController();
    const tesseract = fakeTesseract(() => {
      calls += 1;
      if (calls > 1) return answer("second")();
      // The deadline passes while Tesseract is on the image, not while the worker starts: a
      // fixed delay could land in either under load.
      setTimeout(() => controller.abort(new Error("deadline")), 0);
      return new Promise(() => undefined);
    });
    const recognizer = new TesseractRecognizer({ createWorker: tesseract.createWorker });

    const pending = recognizer.recognize(image, { signal: controller.signal });
    await expect(pending).rejects.toThrow("deadline");
    expect(tesseract.terminated).toEqual([0]);

    expect(await recognizer.recognize(image)).toBe("second");
    expect(tesseract.created).toHaveLength(2);
    await recognizer.terminate();
  });

  it("reports an engine failure as UnreadableImageError without the engine's text", async () => {
    const tesseract = fakeTesseract(() => Promise.reject("Error attempting to read image."));
    const recognizer = new TesseractRecognizer({ createWorker: tesseract.createWorker });

    const error = await recognizer.recognize(image).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(UnreadableImageError);
    expect(String((error as Error).message)).not.toContain("attempting");
    await recognizer.terminate();
  });

  it("fails the start when Tesseract reports an error while loading, and retries later", async () => {
    let attempts = 0;
    const tesseract = fakeTesseract(answer("x"));
    const createWorker = ((langs: string, oem: number, options: Record<string, unknown>) => {
      attempts += 1;
      if (attempts === 1) {
        // Tesseract calls `errorHandler` and never settles `createWorker` in this case.
        (options.errorHandler as (data: unknown) => void)("loading language traineddata failed");
        return new Promise(() => undefined);
      }
      return (tesseract.createWorker as unknown as typeof createWorker)(langs, oem, options);
    }) as unknown as CreateTesseractWorker;
    const recognizer = new TesseractRecognizer({ createWorker });

    await expect(recognizer.recognize(image)).rejects.toThrow("could not start");
    expect(await recognizer.recognize(image)).toBe("x");
    await recognizer.terminate();
  });
});

describe("Tesseract on the sample screenshots (research R3)", () => {
  const recognizer = new TesseractRecognizer();

  afterAll(async () => {
    await recognizer.terminate();
  });

  // Synthetic listings rendered by scripts/render-screenshots.ts; nothing is copied from a real one.
  it.each([
    [
      "es-casa-colibri.png",
      ["casa colibr", "piscina", "llegada a partir de las 15:00", "mascotas"],
    ],
    ["es-apartamento-valle.png", ["apartamento", "balcón", "montañas", "prohibido fumar"]],
    ["en-cedar-cabin.png", ["cedar hollow cabin", "self check-in", "door code 4821", "parking"]],
    [
      "en-harbor-loft.png",
      ["harbor light loft", "wi-fi", "washer and dryer", "pets are not allowed"],
    ],
  ])(
    "reads %s",
    async (file, expected) => {
      const storage = new MemoryStorage({ [KEY]: await readFile(join(FIXTURES, file)) });
      const processFile = createFileProcessor({ storage, recognizer });

      const result = await processFile(SCREENSHOT);

      if (!("text" in result)) throw new Error(`expected text, got ${JSON.stringify(result)}`);
      const text = result.text.toLowerCase().replace(/\s+/g, " ");
      for (const words of expected) expect(text).toContain(words);
      expect(storage.deleted).toEqual([KEY]);
    },
    60_000,
  );

  it("keeps the door code in the text: redaction happens later, in the worker (AC-SEC-014)", async () => {
    const storage = new MemoryStorage({
      [KEY]: await readFile(join(FIXTURES, "en-cedar-cabin.png")),
    });
    const result = await createFileProcessor({ storage, recognizer })(SCREENSHOT);
    expect("text" in result && result.text).toContain("4821");
  }, 60_000);
});
