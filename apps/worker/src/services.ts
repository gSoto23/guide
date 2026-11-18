import { createDb, type DbHandle } from "@guidesk/db";
import {
  AnthropicLlmAdapter,
  createKeyManagement,
  createPmsAdapters,
  FakeLlmAdapter,
  InProcessSandbox,
  LambdaSandbox,
  LocalMediaStorage,
  LocalObjectStorage,
  S3MediaStorage,
  S3ObjectStorage,
  FakeSpeechToText,
  TranscribeSpeechToText,
  type EmailMessage,
  type KeyManagementPort,
  type LlmPort,
  type MediaStoragePort,
  type ObjectStoragePort,
  type SpeechToTextPort,
  type PmsPort,
  type PmsProvider,
  type SandboxPort,
  WebPushAdapter,
  type PushPort,
} from "@guidesk/integrations";
import {
  createFeedReader,
  createFileProcessor,
  createPinnedSend,
  TesseractRecognizer,
} from "@guidesk/sandbox/in-process";
import { Vault } from "@guidesk/vault";
import { VaultDecrypter } from "@guidesk/vault/decrypt";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import type { WorkerConfig } from "./config.js";

/**
 * The adapters feature 002 jobs use (research R1, R2, R5, R6), built once from the settings. The
 * worker runs in the system context (owner connection): RLS policies grant it full access, and
 * every query still names its workspace.
 */
export interface WorkerServices {
  db: DbHandle;
  kms: KeyManagementPort;
  vault: Vault;
  decrypter: VaultDecrypter;
  sandbox: SandboxPort;
  storage: ObjectStoragePort;
  /** Feature 003: the media bucket (research R9). */
  media: MediaStoragePort;
  /** Feature 003: speech to text for voice notes (research R8). */
  speech: SpeechToTextPort;
  /** Media and documents wait for the malware scan (research R9). */
  mediaRequireScan: boolean;
  llm: LlmPort;
  /** PMS adapters; recorded fixtures outside production (T092). */
  pms: Record<PmsProvider, PmsPort>;
  /** HMAC of a normalized calendar link with the feed pepper, as the API computes it (FR-020). */
  feedFingerprint: (normalizedUrl: string) => string;
  portalUrl: string;
  /** Queues a rendered email for the email job (retries with backoff). */
  queueEmail: (message: EmailMessage) => Promise<void>;
  /** Feature 006: web push, or null when the deployment has no VAPID keys (research R7). */
  push: PushPort | null;
  close: () => Promise<void>;
}

function createStorage(config: WorkerConfig): ObjectStoragePort {
  const storage = config.integrations.storage;
  return storage.mode === "s3"
    ? new S3ObjectStorage({ bucket: storage.bucket })
    : new LocalObjectStorage({
        dir: storage.dir,
        uploadUrl: `${config.portalUrl}/api/v1/local-uploads`,
      });
}

/**
 * The media bucket; locally a folder under the uploads folder, with URLs signed like the API's
 * (the same secret, derived from FEED_URL_PEPPER).
 */
function createMedia(config: WorkerConfig): MediaStoragePort {
  const storage = config.integrations.storage;
  return storage.mode === "s3"
    ? new S3MediaStorage({ bucket: storage.mediaBucket })
    : new LocalMediaStorage({
        dir: storage.dir,
        mediaUrl: `${config.portalUrl}/api/v1/local-media`,
        secret: createHmac("sha256", config.integrations.feedUrlPepper)
          .update("guidesk-local-media")
          .digest(),
      });
}

function createSandbox(
  config: WorkerConfig,
  storage: ObjectStoragePort,
  media: MediaStoragePort,
): { sandbox: SandboxPort; close: () => Promise<void> } {
  const settings = config.integrations.sandbox;
  if (settings.mode === "lambda") {
    return {
      sandbox: new LambdaSandbox({
        feedReaderFunction: settings.feedReaderFunction,
        fileProcessorFunction: settings.fileProcessorFunction,
      }),
      close: async () => undefined,
    };
  }
  const ca = settings.testCaFile ? readFileSync(settings.testCaFile, "utf8") : undefined;
  const recognizer = new TesseractRecognizer();
  return {
    sandbox: new InProcessSandbox({
      readFeed: createFeedReader({
        ...(settings.testAllowHost ? { testAllowHost: settings.testAllowHost } : {}),
        ...(ca ? { send: createPinnedSend(ca) } : {}),
      }),
      processFile: createFileProcessor({
        storage,
        recognizer,
        mediaSink: { put: (key, bytes, contentType) => media.put(key, bytes, contentType) },
        readScannedPdfPages: config.integrations.flags.guideScannedPdf,
      }),
    }),
    close: () => recognizer.terminate(),
  };
}

function createLlm(config: WorkerConfig): LlmPort {
  const llm = config.integrations.llm;
  return llm.mode === "anthropic"
    ? new AnthropicLlmAdapter({ apiKey: llm.apiKey })
    : new FakeLlmAdapter();
}

export function createWorkerServices(
  config: WorkerConfig,
  queueEmail: (message: EmailMessage) => Promise<void>,
): WorkerServices {
  const db = createDb(config.databaseUrl, { max: 5, statementTimeoutMillis: 30_000 });
  const kms = createKeyManagement(config.integrations.kms);
  const storage = createStorage(config);
  const media = createMedia(config);
  const { sandbox, close: closeSandbox } = createSandbox(config, storage, media);
  return {
    db,
    kms,
    vault: new Vault(kms),
    decrypter: new VaultDecrypter(kms),
    sandbox,
    storage,
    media,
    speech:
      config.integrations.speech.mode === "transcribe" && config.integrations.storage.mode === "s3"
        ? new TranscribeSpeechToText({ bucket: config.integrations.storage.bucket })
        : new FakeSpeechToText({
            read: async (key) => (await storage.get(key)) ?? Buffer.alloc(0),
          }),
    // Local storage has no scanner, so there is nothing to wait for (research R9).
    mediaRequireScan:
      config.integrations.mediaRequireScan && config.integrations.storage.mode === "s3",
    llm: createLlm(config),
    pms: createPmsAdapters({ mode: config.integrations.pms.mode }),
    feedFingerprint: (normalizedUrl) =>
      createHmac("sha256", config.integrations.feedUrlPepper).update(normalizedUrl).digest("hex"),
    portalUrl: config.portalUrl,
    queueEmail,
    push: config.integrations.push ? new WebPushAdapter(config.integrations.push) : null,
    close: async () => {
      await closeSandbox();
      await db.pool.end();
    },
  };
}
