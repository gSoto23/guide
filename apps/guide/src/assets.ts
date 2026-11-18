import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Hashed static files written by scripts/build-assets.ts (feature 004 research R3). The manifest
 * maps logical names ("guide.js", "guide.css") to their hashed paths under /assets/.
 */
export interface Assets {
  script: string;
  style: string;
  publicDir: string;
}

export function publicDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.GUIDE_PUBLIC_DIR ?? fileURLToPath(new URL("./public/", import.meta.url));
}

export function loadAssets(dir: string = publicDir()): Assets {
  const manifestPath = join(dir, "assets-manifest.json");
  const manifest: Record<string, string> = existsSync(manifestPath)
    ? (JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, string>)
    : {};
  return {
    script: `/${manifest["guide.js"] ?? "assets/guide.js"}`,
    style: `/${manifest["guide.css"] ?? "assets/guide.css"}`,
    publicDir: dir,
  };
}
