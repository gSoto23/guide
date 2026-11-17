import { createDb, type DbHandle } from "@guidesk/db";
import {
  AnthropicLlmAdapter,
  createKeyManagement,
  FakeLlmAdapter,
  InProcessSandbox,
  LambdaSandbox,
  LocalObjectStorage,
  S3ObjectStorage,
  type EmailMessage,
  type KeyManagementPort,
  type LlmPort,
  type ObjectStoragePort,
  type SandboxPort,
} from "@guidesk/integrations";
import {
  createFeedReader,
  createFileProcessor,
  createPinnedSend,
  TesseractRecognizer,
} from "@guidesk/sandbox/in-process";
import { Vault } from "@guidesk/vault";
import { VaultDecrypter } from "@guidesk/vault/decrypt";
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
  llm: LlmPort;
  portalUrl: string;
  /** Queues a rendered email for the email job (retries with backoff). */
  queueEmail: (message: EmailMessage) => Promise<void>;
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

function createSandbox(
  config: WorkerConfig,
  storage: ObjectStoragePort,
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
      processFile: createFileProcessor({ storage, recognizer }),
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
  const { sandbox, close: closeSandbox } = createSandbox(config, storage);
  return {
    db,
    kms,
    vault: new Vault(kms),
    decrypter: new VaultDecrypter(kms),
    sandbox,
    storage,
    llm: createLlm(config),
    portalUrl: config.portalUrl,
    queueEmail,
    close: async () => {
      await closeSandbox();
      await db.pool.end();
    },
  };
}
