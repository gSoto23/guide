import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { resolveLocalDir } from "../src/settings.js";

/** The local uploads folder is shared by the API and the worker (STORAGE_MODE=local). */
const ROOT = resolve(import.meta.dirname, "../../..");

describe("resolveLocalDir", () => {
  const outside: string[] = [];
  afterAll(async () => {
    for (const dir of outside) await rm(dir, { recursive: true, force: true });
  });

  it("reads a relative folder from the monorepo root, whichever app runs", () => {
    expect(resolveLocalDir(".uploads", join(ROOT, "apps", "api"))).toBe(join(ROOT, ".uploads"));
    expect(resolveLocalDir(".uploads", join(ROOT, "apps", "worker"))).toBe(join(ROOT, ".uploads"));
  });

  it("keeps an absolute folder as it is", () => {
    expect(resolveLocalDir("/var/guidesk/uploads", join(ROOT, "apps", "api"))).toBe(
      "/var/guidesk/uploads",
    );
  });

  it("reads a relative folder from the working directory outside the monorepo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "guidesk-settings-"));
    outside.push(dir);
    expect(resolveLocalDir("uploads", dir)).toBe(join(dir, "uploads"));
  });
});
