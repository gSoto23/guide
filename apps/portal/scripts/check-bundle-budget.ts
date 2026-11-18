// Bundle-size check (spec 001 plan, Performance Budget; T101).
//
// Starts the production build (`next build` must have run), loads each route in
// bundle-budget.json, and adds up the gzip size of every script the HTML loads. That is the
// JavaScript a phone downloads before the page works; chunks loaded later with import() don't
// count. Fails when a route is over the budget.
//
// Usage: pnpm --filter @guidesk/portal bundle:check (Node runs this TypeScript file directly).
import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

import config from "../bundle-budget.json" with { type: "json" };

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.BUNDLE_CHECK_PORT ?? 3100);
const base = `http://127.0.0.1:${port}`;

const server = spawn(path.join(root, "node_modules/.bin/next"), ["start", "--port", String(port)], {
  cwd: root,
  env: { ...process.env, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "inherit"],
});
const stop = () => server.kill("SIGTERM");
process.on("exit", stop);

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`${base}/es/sign-in`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`next start did not answer on ${base} within 30 s`);
}

/**
 * Script URLs in the HTML, in order, without duplicates. `nomodule` scripts (Next.js polyfills
 * for old browsers) are skipped: modern browsers never download them.
 */
function scriptSources(html: string): string[] {
  const sources = new Set<string>();
  for (const [tag, src] of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)) {
    if (src && !/\bnomodule\b/i.test(tag)) sources.add(src);
  }
  return [...sources];
}

const gzipCache = new Map<string, number>();
async function gzipBytes(src: string): Promise<number> {
  const url = new URL(src, base);
  if (!url.pathname.startsWith("/_next/static/")) {
    throw new Error(`Unexpected script outside /_next/static: ${src}`);
  }
  const cached = gzipCache.get(url.pathname);
  if (cached !== undefined) return cached;
  const file = path.join(root, ".next/static", decodeURIComponent(url.pathname.slice(14)));
  const size = gzipSync(await readFile(file)).length;
  gzipCache.set(url.pathname, size);
  return size;
}

let failed = false;
try {
  await waitForServer();
  const rows = [];
  for (const route of config.routes) {
    const response = await fetch(`${base}${route}`, { redirect: "manual" });
    if (response.status !== 200) throw new Error(`${route} answered ${response.status}`);
    const sources = scriptSources(await response.text());
    let total = 0;
    for (const src of sources) total += await gzipBytes(src);
    const kb = total / 1024;
    const over = kb > config.budgetKb;
    failed ||= over;
    rows.push({
      route,
      scripts: sources.length,
      "gzip KB": kb.toFixed(1),
      status: over ? "OVER" : "ok",
    });
  }
  // The guide's text editor loads on demand (feature 003 research R3): its chunks never count
  // toward a route, so they get their own budget. They are the chunks that hold ProseMirror or
  // the locked-field node.
  const chunkDir = path.join(root, ".next/static/chunks");
  const chunkFiles = (await readdir(chunkDir, { recursive: true })).filter((file) =>
    String(file).endsWith(".js"),
  );
  let editorBytes = 0;
  let editorChunks = 0;
  for (const file of chunkFiles) {
    const content = await readFile(path.join(chunkDir, String(file)));
    const text = content.toString("utf8");
    if (text.includes("data-locked-field") || text.includes("ProseMirror")) {
      editorBytes += gzipSync(content).length;
      editorChunks += 1;
    }
  }
  const editorKb = editorBytes / 1024;
  const editorOver = editorChunks === 0 || editorKb > config.editorBudgetKb;
  failed ||= editorOver;
  rows.push({
    route: "(guide text editor, on demand)",
    scripts: editorChunks,
    "gzip KB": editorKb.toFixed(1),
    status: editorChunks === 0 ? "MISSING" : editorOver ? "OVER" : "ok",
  });
  // eslint-disable-next-line no-console -- the report is the output
  console.table(rows);
  process.stdout.write(
    failed
      ? `At least one route is over ${config.budgetKb} KB gzip.\n`
      : `Every route is within ${config.budgetKb} KB gzip.\n`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  failed = true;
} finally {
  stop();
}
process.exit(failed ? 1 : 0);
