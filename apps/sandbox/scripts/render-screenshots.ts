/**
 * Renders the sample listing screenshots used by the file processor tests (T050, research R3)
 * into `apps/sandbox/test/fixtures/screenshots/`.
 *
 *   node apps/sandbox/scripts/render-screenshots.ts
 *
 * Every listing below was written for the suite: the names, places, and codes are invented, and
 * no text was copied from a real listing. Each one is drawn as SVG text on a phone-sized canvas
 * (1170 x 2532, an iPhone screenshot at 3x) and written as a PNG. The output depends on the fonts
 * installed, so rerun the script only when the samples change, and commit the PNGs.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const WIDTH = 1170;
const HEIGHT = 2532;
const MARGIN = 64;
const FONT = "Helvetica Neue, Helvetica, Arial, sans-serif";

interface Listing {
  file: string;
  title: string;
  summary: string;
  description: string[];
  sections: { heading: string; lines: string[] }[];
  price: string;
  button: string;
}

const LISTINGS: Listing[] = [
  {
    file: "es-casa-colibri.png",
    title: "Casa Colibrí junto al mar",
    summary: "Casa entera · 3 habitaciones · 6 huéspedes",
    description: [
      "Casa luminosa a cinco minutos caminando",
      "de la playa, con piscina privada y jardín.",
    ],
    sections: [
      {
        heading: "Lo que ofrece este lugar",
        lines: [
          "Wi-Fi rápido y aire acondicionado",
          "Cocina equipada y lavadora",
          "Estacionamiento gratuito para dos autos",
        ],
      },
      {
        heading: "Reglas de la casa",
        lines: [
          "Llegada a partir de las 15:00",
          "Salida antes de las 11:00",
          "No se permiten fiestas ni eventos",
          "Se aceptan mascotas pequeñas",
        ],
      },
    ],
    price: "$140 noche",
    button: "Reservar",
  },
  {
    file: "es-apartamento-valle.png",
    title: "Apartamento Luz del Valle",
    summary: "Apartamento entero · 1 habitación · 2 huéspedes",
    description: [
      "Apartamento tranquilo en el centro del",
      "pueblo, cerca de cafés y del mercado.",
    ],
    sections: [
      {
        heading: "Comodidades",
        lines: [
          "Balcón con vista a las montañas",
          "Escritorio para trabajar y Wi-Fi",
          "Agua caliente y ropa de cama incluida",
        ],
      },
      {
        heading: "Normas",
        lines: [
          "Horario de silencio de 22:00 a 7:00",
          "Prohibido fumar dentro del apartamento",
          "Llegada flexible después de las 14:00",
        ],
      },
    ],
    price: "$65 noche",
    button: "Reservar",
  },
  {
    file: "en-cedar-cabin.png",
    title: "Cedar Hollow Cabin",
    summary: "Entire cabin · 2 bedrooms · 4 guests",
    description: [
      "A quiet wooden cabin at the edge of the",
      "forest, with a wood stove and a porch.",
    ],
    sections: [
      {
        heading: "Check-in instructions",
        lines: [
          "Self check-in after 4:00 PM",
          "Door code 4821",
          "Parking is in the gravel area by the shed",
        ],
      },
      {
        heading: "House rules",
        lines: [
          "Checkout by 10:00 AM",
          "No smoking anywhere on the property",
          "Please keep the gate closed",
        ],
      },
    ],
    price: "$180 night",
    button: "Reserve",
  },
  {
    file: "en-harbor-loft.png",
    title: "Harbor Light Loft",
    summary: "Entire loft · 1 bedroom · 3 guests",
    description: [
      "A bright loft above a bakery, a short",
      "walk from the harbor and the ferry pier.",
    ],
    sections: [
      {
        heading: "What this place offers",
        lines: [
          "Fast Wi-Fi and a dedicated workspace",
          "Washer and dryer in the unit",
          "Coffee maker and a full kitchen",
        ],
      },
      {
        heading: "House rules",
        lines: [
          "Quiet hours from 10:00 PM to 7:00 AM",
          "No parties or events",
          "Pets are not allowed",
        ],
      },
    ],
    price: "$120 night",
    button: "Reserve",
  },
];

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function text(x: number, y: number, size: number, value: string, extra = ""): string {
  return `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${escapeXml(value)}</text>`;
}

/** Draws one listing as a phone screenshot: status bar, app bar, photo, details, booking bar. */
function renderSvg(listing: Listing): string {
  const parts: string[] = [];
  parts.push(`<rect width="${WIDTH}" height="${HEIGHT}" fill="#ffffff"/>`);
  // Status bar and app bar.
  parts.push(text(MARGIN, 96, 44, "9:41", `font-weight="600" fill="#111111"`));
  parts.push(`<rect x="${WIDTH - 150}" y="62" width="84" height="40" rx="10" fill="#111111"/>`);
  parts.push(text(MARGIN, 210, 44, "‹  Back", `fill="#1f5fbf"`));
  // A flat photo placeholder, as listing pages open with a photo.
  parts.push(`<rect x="0" y="260" width="${WIDTH}" height="720" fill="#9fb8ad"/>`);
  parts.push(`<circle cx="${WIDTH - 180}" cy="420" r="90" fill="#f1d38a"/>`);

  let y = 1080;
  parts.push(text(MARGIN, y, 64, listing.title, `font-weight="700" fill="#111111"`));
  y += 76;
  parts.push(text(MARGIN, y, 38, listing.summary, `fill="#555555"`));
  y += 96;
  for (const line of listing.description) {
    parts.push(text(MARGIN, y, 42, line, `fill="#222222"`));
    y += 60;
  }
  for (const section of listing.sections) {
    y += 40;
    parts.push(
      `<rect x="${MARGIN}" y="${y - 30}" width="${WIDTH - 2 * MARGIN}" height="2" fill="#dddddd"/>`,
    );
    y += 60;
    parts.push(text(MARGIN, y, 50, section.heading, `font-weight="700" fill="#111111"`));
    y += 72;
    for (const line of section.lines) {
      parts.push(text(MARGIN, y, 42, line, `fill="#222222"`));
      y += 60;
    }
  }
  // Booking bar.
  parts.push(`<rect x="0" y="${HEIGHT - 260}" width="${WIDTH}" height="260" fill="#f6f6f6"/>`);
  parts.push(text(MARGIN, HEIGHT - 140, 48, listing.price, `font-weight="700" fill="#111111"`));
  parts.push(
    `<rect x="${WIDTH - 420}" y="${HEIGHT - 210}" width="356" height="110" rx="24" fill="#d6336c"/>`,
  );
  parts.push(
    text(
      WIDTH - 242,
      HEIGHT - 138,
      46,
      listing.button,
      `font-weight="700" fill="#ffffff" text-anchor="middle"`,
    ),
  );

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" font-family="${FONT}">`,
    ...parts,
    "</svg>",
  ].join("\n");
}

const outputFolder = join(import.meta.dirname, "..", "test", "fixtures", "screenshots");
await mkdir(outputFolder, { recursive: true });

for (const listing of LISTINGS) {
  const png = await sharp(Buffer.from(renderSvg(listing)))
    // A small palette keeps the committed files small without blurring the text.
    .png({ palette: true, colours: 32, compressionLevel: 9 })
    .toBuffer();
  await writeFile(join(outputFolder, listing.file), png);
  process.stdout.write(`${listing.file}: ${png.length} bytes\n`);
}
