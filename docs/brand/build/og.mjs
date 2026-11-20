// The link-preview images (feature 015 research R12): 1200 × 630, the logo and the tagline on cal,
// with the arch, bubble, and sun of the brand vocabulary. Rastered with sharp (librsvg).
// Usage, from the repository root: node docs/brand/build/og.mjs
import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const store = path.join(repo, "node_modules/.pnpm");
const sharpDir = readdirSync(store).find((name) => name.startsWith("sharp@"));
if (!sharpDir) throw new Error("sharp not found: run pnpm install first");
const sharp = createRequire(import.meta.url)(path.join(store, sharpDir, "node_modules/sharp"));

// The logo's inner drawing (its view box is 199.46 × 48.35), without the outer svg and title.
const logo = readFileSync(path.join(here, "../logo/guidesk-logo.svg"), "utf8")
  .replace(/^<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(/<title>.*?<\/title>/, "");

const TAGLINES = {
  es: ["Tu casa, siempre lista", "para responder."],
  en: ["Your home, always", "ready to answer."],
};

/** The bubble of the mark, with the square corner at the bottom left. */
function bubble(x, y, width, height, r) {
  return (
    `M${x} ${y + height}V${y + r}a${r} ${r} 0 0 1 ${r}-${r}h${width - 2 * r}` +
    `a${r} ${r} 0 0 1 ${r} ${r}v${height - 2 * r}a${r} ${r} 0 0 1-${r} ${r}Z`
  );
}

function svg(lines) {
  const font = "Helvetica Neue, Helvetica, Arial, sans-serif";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#FFFCF8"/>
  <rect x="760" width="440" height="630" fill="#F7F1EA"/>
  <circle cx="1060" cy="170" r="70" fill="#F5BC4C"/>
  <path d="M880 520V330a100 100 0 0 1 200 0V520Z" fill="#B4452A"/>
  <path d="M927 520V345a53 53 0 0 1 106 0V520Z" fill="#F5BC4C"/>
  <path d="${bubble(800, 170, 150, 104, 30)}" fill="#F3D3C7"/>
  <circle cx="846" cy="222" r="9" fill="#FFFCF8"/>
  <circle cx="875" cy="222" r="9" fill="#FFFCF8"/>
  <circle cx="904" cy="222" r="9" fill="#FFFCF8"/>
  <path d="M790 520h380" stroke="#8C7B70" stroke-width="6" stroke-linecap="round"/>
  <g transform="translate(80 110) scale(2.2)">${logo}</g>
  <text x="80" y="330" font-family="${font}" font-size="58" font-weight="700" fill="#2B211C">
    <tspan x="80">${lines[0]}</tspan><tspan x="80" dy="72">${lines[1]}</tspan>
  </text>
  <rect x="80" y="470" width="96" height="10" rx="5" fill="#B4452A"/>
</svg>`;
}

for (const [lang, lines] of Object.entries(TAGLINES)) {
  const target = path.join(repo, `apps/portal/public/brand/og-${lang}.png`);
  await sharp(Buffer.from(svg(lines)))
    .png({ compressionLevel: 9, palette: true, colors: 64 })
    .toFile(target);
  console.log(`${path.relative(repo, target)}: ${Math.round(statSync(target).size / 1024)} KB`);
}
