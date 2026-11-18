/**
 * Size check for the guest app (feature 004 SC-001, plan Performance Budget): the browser script
 * at most 15 KB gzip, and script plus styles plus a rendered home page at most 150 KB.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist", "public");
const manifest = JSON.parse(readFileSync(join(out, "assets-manifest.json"), "utf8")) as Record<
  string,
  string
>;
const gz = (path: string) => gzipSync(readFileSync(join(out, path))).length / 1024;

const script = gz(manifest["guide.js"]!);
const style = gz(manifest["guide.css"]!);
const SCRIPT_BUDGET_KB = 15;
const PAGE_BUDGET_KB = 150;

const { createHandler } = await import(join(root, "dist", "handler.js"));
const { loadConfig } = await import(join(root, "dist", "config.js"));
const { loadAssets } = await import(join(root, "dist", "assets.js"));
const { FIXTURE_PUBLIC_ID } = await import(join(root, "dist", "fixtures", "guide.js"));
const handle = createHandler({
  config: { ...loadConfig(), fixtures: true },
  assets: loadAssets(out),
});
const response: Response = await handle(new Request(`http://localhost/g/${FIXTURE_PUBLIC_ID}/es`));
const home = gzipSync(Buffer.from(await response.text())).length / 1024;
const total = script + style + home;

console.warn("Guest guide size (gzip KB)");
// eslint-disable-next-line no-console -- a build report
console.table([
  { file: "guide.js", gzipKb: script.toFixed(1), budgetKb: SCRIPT_BUDGET_KB },
  { file: "guide.css", gzipKb: style.toFixed(1), budgetKb: "-" },
  { file: "home.html", gzipKb: home.toFixed(1), budgetKb: "-" },
  { file: "total", gzipKb: total.toFixed(1), budgetKb: PAGE_BUDGET_KB },
]);
if (response.status !== 200) throw new Error(`Fixture home answered ${response.status}`);
if (script > SCRIPT_BUDGET_KB || total > PAGE_BUDGET_KB) {
  console.error("Guest guide over its size budget");
  process.exit(1);
}
