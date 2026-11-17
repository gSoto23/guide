import { randomUUID } from "node:crypto";
import { access, copyFile, mkdir, rename, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import Tesseract from "tesseract.js";
import { UnreadableImageError, type TextRecognitionPort } from "@guidesk/integrations/ocr-port";

/**
 * Text recognition with Tesseract (`tesseract.js`, WebAssembly) behind `TextRecognitionPort`
 * (research R3). It runs inside the file processor (research R2) and never touches the network:
 *
 * - the Spanish and English models are read from a local folder (`langPath`), which is never a
 *   URL, and the recognizer refuses to start when a model is missing there, so Tesseract never
 *   falls back to its CDN;
 * - no `workerPath` or `corePath` is passed: the Node build loads its worker script and its
 *   WebAssembly core from `node_modules`;
 * - images are passed as buffers, never as URLs.
 *
 * Recognized text is confidential: it is returned to the caller and never logged. Tesseract's
 * own logging stays off, and its progress messages are dropped.
 */

/** Spanish and English, recognized together (research R3). */
export const RECOGNITION_LANGUAGES = ["spa", "eng"] as const;

/** The models bundled in `@tesseract.js-data/*`: LSTM-only, integer "best" models. */
const BUNDLED_MODELS = "4.0.0_best_int";

/** This recognizer's files in the OS temp folder: the model cache and, in development, the models. */
const TEMP_FOLDER = join(tmpdir(), "guidesk-tesseract");

/** A scheme such as `https:` or `file:`: `langPath` must be a plain folder path. */
const URL_SCHEME = /^[a-z][a-z\d+.-]*:/i;

export type CreateTesseractWorker = (
  langs: string,
  oem: Tesseract.OEM,
  options: Partial<Tesseract.WorkerOptions>,
) => Promise<Tesseract.Worker>;

export interface TesseractRecognizerOptions {
  /**
   * Folder holding `spa.traineddata.gz` and `eng.traineddata.gz`. Defaults to
   * `TESSERACT_LANG_PATH` (`lang`, next to the Lambda handler, in AWS), resolved from the task
   * root; without it, the models of the `@tesseract.js-data` packages are copied to the temp
   * folder, since Tesseract reads every model from one folder.
   */
  langPath?: string;
  /** Where Tesseract caches the unpacked models. Defaults to a folder in the OS temp folder. */
  cachePath?: string;
  /** Tesseract's `createWorker`; tests replace it to check the options. */
  createWorker?: CreateTesseractWorker;
}

/** The started Tesseract worker, with a way to fail the jobs still waiting on it. */
interface RunningWorker {
  worker: Tesseract.Worker;
  /** Rejects once the worker is terminated, so waiting jobs fail instead of hanging. */
  terminated: Promise<never>;
  markTerminated: () => void;
  isTerminated: () => boolean;
}

export class TesseractRecognizer implements TextRecognitionPort {
  private readonly createWorker: CreateTesseractWorker;
  private running: Promise<RunningWorker> | null = null;

  constructor(private readonly options: TesseractRecognizerOptions = {}) {
    this.createWorker = options.createWorker ?? Tesseract.createWorker;
  }

  /**
   * Recognizes one image with the shared worker, started on first use. Tesseract cannot stop in
   * the middle of a page, so an abort terminates the worker and the next call starts a new one.
   */
  async recognize(image: Buffer, options: { signal?: AbortSignal } = {}): Promise<string> {
    const { signal } = options;
    signal?.throwIfAborted();
    const starting = this.start();
    const running = await untilAborted(starting, signal);
    try {
      const result = await untilAborted(
        Promise.race([running.worker.recognize(image), running.terminated]),
        signal,
      );
      return result.data.text;
    } catch {
      if (signal?.aborted) {
        await this.stop(starting, running);
        throw signal.reason;
      }
      // Another call aborted and terminated the shared worker: not a fault of this image.
      if (running.isTerminated()) throw new Error("Tesseract was terminated during recognition");
      // Tesseract's error text is dropped: only the fact that the image was not read is kept.
      throw new UnreadableImageError();
    }
  }

  /** Terminates the shared worker. A later `recognize` starts a new one. */
  async terminate(): Promise<void> {
    const starting = this.running;
    if (!starting) return;
    const running = await starting.catch(() => null);
    if (running) await this.stop(starting, running);
    else if (this.running === starting) this.running = null;
  }

  private start(): Promise<RunningWorker> {
    if (!this.running) {
      const starting = this.launch();
      this.running = starting;
      // A failed start is not kept, so the next call tries again.
      starting.catch(() => {
        if (this.running === starting) this.running = null;
      });
    }
    return this.running;
  }

  private async stop(starting: Promise<RunningWorker>, running: RunningWorker): Promise<void> {
    if (this.running === starting) this.running = null;
    running.markTerminated();
    await running.worker.terminate();
  }

  private async launch(): Promise<RunningWorker> {
    const langPath = await resolveLangPath(this.options.langPath);
    await requireModels(langPath);
    const cachePath = this.options.cachePath ?? join(TEMP_FOLDER, "cache");
    await mkdir(cachePath, { recursive: true, mode: 0o700 });

    // When a model cannot be loaded, Tesseract calls `errorHandler` but never settles
    // `createWorker`, so the handler fails the start. Without a handler, Tesseract would throw
    // its errors from an event listener and end the process.
    let failStart: (error: Error) => void = () => undefined;
    const startFailed = new Promise<never>((_, reject) => {
      failStart = reject;
    });
    const creating = this.createWorker(RECOGNITION_LANGUAGES.join("+"), Tesseract.OEM.LSTM_ONLY, {
      langPath,
      cachePath,
      gzip: true,
      logger: () => undefined,
      errorHandler: () => failStart(new Error("Tesseract could not start")),
    });

    let worker: Tesseract.Worker;
    try {
      worker = await Promise.race([creating, startFailed]);
    } catch {
      void creating.then(
        (late) => late.terminate(),
        () => undefined,
      );
      throw new Error("Tesseract could not start");
    }

    let stopped = false;
    let markTerminated: () => void = () => undefined;
    const terminated = new Promise<never>((_, reject) => {
      markTerminated = () => {
        stopped = true;
        reject(new Error("Tesseract was terminated"));
      };
    });
    // Nothing may be waiting when the worker is terminated.
    terminated.catch(() => undefined);
    return { worker, terminated, markTerminated, isTerminated: () => stopped };
  }
}

/** The local folder holding the models; never a URL, so Tesseract never downloads one. */
async function resolveLangPath(configured: string | undefined): Promise<string> {
  const value = configured ?? process.env.TESSERACT_LANG_PATH;
  if (value === undefined || value === "") return stageBundledModels(join(TEMP_FOLDER, "lang"));
  if (URL_SCHEME.test(value)) {
    throw new Error("The Tesseract language folder must be a local path, not a URL");
  }
  // In Lambda the models are copied next to the handler, under the task root (infra/sandbox.ts).
  return resolve(process.env.LAMBDA_TASK_ROOT ?? process.cwd(), value);
}

/** Refuses to start without both models: Tesseract would otherwise try its CDN. */
async function requireModels(langPath: string): Promise<void> {
  try {
    await Promise.all(
      RECOGNITION_LANGUAGES.map((lang) => access(join(langPath, `${lang}.traineddata.gz`))),
    );
  } catch {
    throw new Error("The Tesseract language models are missing; they are never downloaded");
  }
}

/**
 * Copies the models of the `@tesseract.js-data` packages into one folder, for development and
 * tests. Each file is copied under a temporary name and renamed, so a process starting at the
 * same time never reads half a file.
 */
async function stageBundledModels(folder: string): Promise<string> {
  const require = createRequire(import.meta.url);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  for (const lang of RECOGNITION_LANGUAGES) {
    const packageFolder = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    const source = join(packageFolder, BUNDLED_MODELS, `${lang}.traineddata.gz`);
    const target = join(folder, `${lang}.traineddata.gz`);
    const [sourceStat, targetStat] = await Promise.all([
      stat(source),
      stat(target).catch(() => null),
    ]);
    if (targetStat?.size === sourceStat.size) continue;
    const partial = `${target}.${randomUUID()}.partial`;
    await copyFile(source, partial);
    await rename(partial, target);
  }
  return folder;
}

/** Settles with `work`, or rejects with the signal's reason as soon as it aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return work;
  return new Promise<T>((resolvePromise, reject) => {
    const onAbort = (): void => reject(signal.reason);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    void work
      .then(resolvePromise, reject)
      .finally(() => signal.removeEventListener("abort", onAbort));
  });
}
