import { readFileSync } from "node:fs";
import { initSandboxSentry, instrumentHandler } from "../observability.js";
import { createFeedReader, type FeedReaderDeps } from "./reader.js";
import { createPinnedSend } from "./safe-fetch.js";

/** Test allowances apply only outside production; production never sets them (T006). */
function depsFromEnvironment(): FeedReaderDeps {
  if (process.env.NODE_ENV === "production") return {};
  const host = process.env.SANDBOX_TEST_ALLOW_HOST;
  const caFile = process.env.SANDBOX_TEST_CA_FILE;
  return {
    ...(host ? { testAllowHost: host } : {}),
    ...(caFile ? { send: createPinnedSend(readFileSync(caFile, "utf8")) } : {}),
  };
}

initSandboxSentry("feed-reader");

/** The Lambda entry point: outside the VPC, with no IAM permissions (infra/sandbox.ts). */
export const handler = instrumentHandler("feed-reader", createFeedReader(depsFromEnvironment()));
