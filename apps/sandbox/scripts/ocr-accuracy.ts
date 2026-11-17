/**
 * The text-recognition accuracy gate (research R3, T057). It renders 30 phone screenshots (15
 * Spanish, 15 English) from the synthetic listings of the extraction eval suite
 * (`evals/extraction/cases/listings/`), runs them through the same normalization and Tesseract
 * recognizer as the file processor, and reports character accuracy:
 * 1 − (edit distance ÷ characters of the rendered text), per screenshot and overall.
 *
 *   pnpm --filter @guidesk/sandbox build && node apps/sandbox/scripts/ocr-accuracy.ts [--muted]
 *
 * `--muted` is a stress run, not the gate: smaller gray text (#767676, the lightest gray that meets
 * WCAG AA on white) on a light gray background (#f6f6f6), like secondary text in listing apps.
 *
 * The gate is 95%. Below it, the Textract adapter replaces Tesseract before screenshots are
 * turned on in production.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const WIDTH = 1170;
const HEIGHT = 2532;
const MARGIN = 64;
const MUTED = process.argv.includes("--muted");
const LINE_HEIGHT = MUTED ? 50 : 60;
const FONT_SIZE = MUTED ? 34 : 42;
const MAX_CHARS = MUTED ? 52 : 42;
const TEXT_COLOR = MUTED ? "#767676" : "#222222";
const BACKGROUND = MUTED ? "#f6f6f6" : "#ffffff";
const MAX_LINES = Math.floor((HEIGHT - 2 * MARGIN) / LINE_HEIGHT);
const casesDir = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "evals",
  "extraction",
  "cases",
  "listings",
);

function wrap(text: string): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      if ((line ? `${line} ${word}` : word).length > MAX_CHARS && line) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.slice(0, MAX_LINES);
}

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function render(lines: string[]): Promise<Buffer> {
  const texts = lines.map(
    (line, index) =>
      `<text x="${MARGIN}" y="${MARGIN + (index + 1) * LINE_HEIGHT}" font-size="${FONT_SIZE}" fill="${TEXT_COLOR}">${escapeXml(line)}</text>`,
  );
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif"><rect width="${WIDTH}" height="${HEIGHT}" fill="${BACKGROUND}"/>${texts.join("")}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
    }
    previous = current;
  }
  return previous[b.length]!;
}

const files = readdirSync(casesDir)
  .filter((file) => file.endsWith(".json"))
  .sort();
// Every screenshot is drawn first: importing the file processor's image module blocks every
// decoder but JPEG, PNG, and WebP for the whole process, SVG included (research R9).
const screenshots: { id: string; language: string; truth: string; png: Buffer }[] = [];
for (const file of files) {
  const listing = JSON.parse(readFileSync(join(casesDir, file), "utf8")) as {
    id: string;
    language: string;
    text: string;
  };
  const lines = wrap(listing.text);
  screenshots.push({
    id: listing.id,
    language: listing.language,
    truth: normalize(lines.join("\n")),
    png: await render(lines),
  });
}

const { normalizeImage } = await import("../dist/file-processor/images.js");
const { TesseractRecognizer } = await import("../dist/file-processor/ocr.js");
const recognizer = new TesseractRecognizer();
const results: {
  id: string;
  language: string;
  accuracy: number;
  characters: number;
  distance: number;
}[] = [];
try {
  for (const { id, language, truth, png } of screenshots) {
    const normalized = await normalizeImage(png, "png");
    if (!("image" in normalized)) throw new Error(`could not normalize ${id}`);
    const recognized = normalize(await recognizer.recognize(normalized.image));
    const distance = editDistance(truth, recognized);
    results.push({
      id,
      language,
      accuracy: 1 - distance / truth.length,
      characters: truth.length,
      distance,
    });
  }
} finally {
  await recognizer.terminate();
}

const overall = (subset: typeof results) =>
  1 -
  subset.reduce((sum, r) => sum + r.distance, 0) / subset.reduce((sum, r) => sum + r.characters, 0);
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;
for (const result of results) {
  process.stdout.write(`${result.id.padEnd(48)} ${result.language}  ${percent(result.accuracy)}\n`);
}
const total = overall(results);
process.stdout.write(
  `\nStyle: ${MUTED ? "muted (stress run)" : "standard (gate)"}\n` +
    `Screenshots: ${results.length} (${results.filter((r) => r.language === "es").length} es, ${results.filter((r) => r.language === "en").length} en)\n` +
    `Spanish: ${percent(overall(results.filter((r) => r.language === "es")))}\n` +
    `English: ${percent(overall(results.filter((r) => r.language === "en")))}\n` +
    `Overall character accuracy: ${percent(total)} (gate 95%): ${total >= 0.95 ? "PASS" : "FAIL"}\n`,
);
