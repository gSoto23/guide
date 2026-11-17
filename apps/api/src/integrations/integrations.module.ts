import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { Global, Module } from "@nestjs/common";
import {
  createKeyManagement,
  InProcessSandbox,
  LambdaSandbox,
  type KeyManagementPort,
  type SandboxPort,
} from "@guidesk/integrations";
import { createFeedReader, createPinnedSend } from "@guidesk/sandbox/in-process";
import { Vault } from "@guidesk/vault";
import { API_CONFIG, type ApiConfig } from "../config/config.js";

export const SANDBOX = Symbol("SANDBOX");
export const KEY_MANAGEMENT = Symbol("KEY_MANAGEMENT");
export const VAULT = Symbol("VAULT");
export const FEED_FINGERPRINT = Symbol("FEED_FINGERPRINT");

/** HMAC-SHA-256 of a normalized calendar link with FEED_URL_PEPPER (data model §3). */
export type FeedFingerprint = (normalizedUrl: string) => string;

/**
 * The API only reads feeds through the sandbox (saving a link checks it first, FR-021). In
 * development and tests the feed reader runs in process, with the fixture server's allowances;
 * in AWS it is the Lambda function outside the VPC (research R2).
 */
function createSandbox(config: ApiConfig): SandboxPort {
  const sandbox = config.integrations.sandbox;
  if (sandbox.mode === "lambda") {
    return new LambdaSandbox({
      feedReaderFunction: sandbox.feedReaderFunction,
      fileProcessorFunction: sandbox.fileProcessorFunction,
    });
  }
  const ca = sandbox.testCaFile ? readFileSync(sandbox.testCaFile, "utf8") : undefined;
  return new InProcessSandbox({
    readFeed: createFeedReader({
      ...(sandbox.testAllowHost ? { testAllowHost: sandbox.testAllowHost } : {}),
      ...(ca ? { send: createPinnedSend(ca) } : {}),
    }),
    // The API never processes uploaded files; the worker does.
    processFile: async () => ({ error: "internal" }),
  });
}

/** Keys, the vault, and the sandbox for feature 002 (research R2, R5). */
@Global()
@Module({
  providers: [
    { provide: SANDBOX, inject: [API_CONFIG], useFactory: createSandbox },
    {
      provide: KEY_MANAGEMENT,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): KeyManagementPort =>
        createKeyManagement(config.integrations.kms),
    },
    {
      provide: VAULT,
      inject: [KEY_MANAGEMENT],
      useFactory: (kms: KeyManagementPort) => new Vault(kms),
    },
    {
      provide: FEED_FINGERPRINT,
      inject: [API_CONFIG],
      useFactory:
        (config: ApiConfig): FeedFingerprint =>
        (normalizedUrl) =>
          createHmac("sha256", config.integrations.feedUrlPepper)
            .update(normalizedUrl)
            .digest("hex"),
    },
  ],
  exports: [SANDBOX, KEY_MANAGEMENT, VAULT, FEED_FINGERPRINT],
})
export class IntegrationsModule {}
