// Rasterise the app icons with sharp (librsvg), which Next.js already installs.
// Usage, from the repository root: node docs/brand/build/raster.mjs
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const store = path.join(repo, "node_modules/.pnpm");
const sharpDir = readdirSync(store).find((name) => name.startsWith("sharp@"));
if (!sharpDir) throw new Error("sharp not found: run pnpm install first");
const sharp = createRequire(import.meta.url)(path.join(store, sharpDir, "node_modules/sharp"));

const icons = path.join(here, "../icons");
const jobs = [
  ["app-icon.svg", 180, path.join(icons, "apple-touch-icon.png")],
  ["app-icon.svg", 180, path.join(repo, "apps/portal/app/apple-icon.png")],
  ["app-icon.svg", 512, path.join(icons, "icon-maskable-512.png")],
  ["app-icon-rounded.svg", 192, path.join(icons, "icon-192.png")],
  ["app-icon-rounded.svg", 512, path.join(icons, "icon-512.png")],
  ["favicon.svg", 16, path.join(here, "out/favicon-16.png")],
  ["favicon.svg", 32, path.join(here, "out/favicon-32.png")],
  ["favicon.svg", 48, path.join(here, "out/favicon-48.png")],
];

for (const [source, size, target] of jobs) {
  await sharp(path.join(icons, source), { density: 72 * (size / 16) * 4 })
    .resize(size, size)
    .png({ compressionLevel: 9, palette: size <= 48 })
    .toFile(target);
  console.log(`${path.relative(repo, target)} ${size}px`);
}
