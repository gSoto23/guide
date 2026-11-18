/**
 * Builds the guest app's static files (feature 004 research R3): the browser script and service
 * worker with esbuild, the stylesheet, and the icons, with content hashes for long caching.
 * Writes dist/public/assets-manifest.json for the server.
 */
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "public");
const repo = join(root, "..", "..");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "assets"), { recursive: true });
mkdirSync(join(out, "icons"), { recursive: true });

const hash = (content: Buffer | string) =>
  createHash("sha256").update(content).digest("hex").slice(0, 10);

async function bundle(entry: string): Promise<string> {
  const result = await build({
    entryPoints: [join(root, entry)],
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2020", "safari15"],
    write: false,
    legalComments: "none",
  });
  return result.outputFiles[0]!.text;
}

const manifest: Record<string, string> = {};

const script = await bundle("src/client/guide.ts");
manifest["guide.js"] = `assets/guide.${hash(script)}.js`;
writeFileSync(join(out, manifest["guide.js"]), script);

const css = readFileSync(join(root, "styles", "guide.css"), "utf8");
const minified = (
  await build({
    stdin: { contents: css, loader: "css" },
    minify: true,
    write: false,
    loader: { ".css": "css" },
  })
).outputFiles[0]!.text;
manifest["guide.css"] = `assets/guide.${hash(minified)}.css`;
writeFileSync(join(out, manifest["guide.css"]), minified);

// The service worker keeps a stable path (/sw.js); browsers check it for updates on every visit.
writeFileSync(join(out, "sw.js"), await bundle("src/client/sw.ts"));

for (const icon of [
  "favicon.svg",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "apple-touch-icon.png",
]) {
  copyFileSync(join(repo, "docs", "brand", "icons", icon), join(out, "icons", icon));
}

writeFileSync(join(out, "assets-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.warn(`Guest assets: ${Object.values(manifest).join(", ")}, sw.js`);
