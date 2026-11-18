import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GuestGuide } from "@guidesk/contracts";
import { fixtureGuide } from "../src/fixtures/guide.js";
import { SectionPage, HomePage } from "../src/pages/guide-pages.js";
import { translator } from "../src/i18n.js";
import { fixtureHandler, FIXTURE_PUBLIC_ID, get } from "./helpers.js";

/** What guests see (feature 004 T022): order, facts, placeholders, disclosures, languages. */
const assets = { script: "/a.js", style: "/a.css", publicDir: "/tmp" };

function render(guide: GuestGuide, sectionId?: string): string {
  const input = { t: translator(guide.language), locale: guide.language, assets, guide };
  return renderToString(
    sectionId ? <SectionPage {...input} sectionId={sectionId} /> : <HomePage {...input} />,
  );
}

const base = fixtureGuide(FIXTURE_PUBLIC_ID, "es")!;

describe("guide pages", () => {
  it("lists visible sections in order with Arrival first and wide, and the times", async () => {
    const html = await (await fixtureHandler()(get(`/g/${FIXTURE_PUBLIC_ID}/es`))).text();
    const order = [
      "Llegada y acceso",
      "Wi-Fi",
      "Normas de la casa",
      "Electrodomésticos",
      "Emergencias",
      "Salida",
    ];
    const positions = order.map((title) => html.indexOf(`>${title}</a>`));
    expect(positions.every((position) => position > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(html).toContain('class="tile-wide"');
    expect(html).toContain("desde las 15:00");
    expect(html).toContain("hasta las 11:00");
    expect(html).toContain("https://www.google.com/maps/search/?api=1&amp;query=");
    expect(html).toContain("https://waze.com/ul?q=");
    expect(html).toContain(`href="/g/${FIXTURE_PUBLIC_ID}/es/emergency"`);
    expect(html).toContain(`href="/g/${FIXTURE_PUBLIC_ID}/en"`);
  });

  it("renders locked fields as placeholders with their label and every state text for the script", () => {
    const html = render(base, "00000000-0000-4000-8000-000000000001");
    expect(html).toContain('data-field-id="00000000-0000-4000-8000-0000000000f1"');
    expect(html).toContain("Código de la caja");
    expect(html).toContain("Los códigos aparecen solo con tu enlace de estadía.");
    expect(html).toContain("Tus datos de acceso también están en los mensajes de tu reserva.");
    expect(html).toContain('id="guest-texts"');
    expect(html).toContain("Disponible desde el {date}.");
  });

  it("shows a public Wi-Fi password with Copy, and 'Ask your host' for a field without a value", () => {
    const guide: GuestGuide = {
      ...base,
      wifi: { fieldId: "00000000-0000-4000-8000-0000000000f1", password: "PalmeraAzul77" },
    };
    expect(render(guide, "00000000-0000-4000-8000-000000000001")).toContain(
      'data-copy="PalmeraAzul77"',
    );
    const unset: GuestGuide = {
      ...base,
      lockedFields: base.lockedFields.map((field) => ({ ...field, set: false })),
    };
    const html = render(unset, "00000000-0000-4000-8000-000000000001");
    expect(html).toContain("Pregúntale a tu anfitrión.");
    expect(html).not.toContain("data-field-id");
  });

  it("discloses benefits, marks untranslated items, and keeps links safe", () => {
    const guide: GuestGuide = {
      ...base,
      sections: [
        {
          id: "00000000-0000-4000-8000-000000000009",
          kind: "local_recommendations",
          title: null,
          items: [
            {
              id: "00000000-0000-4000-8000-000000000901",
              kind: "recommendation",
              language: "es",
              translated: true,
              doc: null,
              recommendation: {
                name: "Soda La Palma",
                category: "restaurant",
                url: "javascript:alert(1)",
                address: null,
                benefit: true,
                benefitKind: "commission",
                personalTip: false,
              },
            },
            {
              id: "00000000-0000-4000-8000-000000000902",
              kind: "text",
              language: "en",
              translated: false,
              doc: {
                type: "doc",
                content: [
                  {
                    type: "paragraph",
                    content: [
                      {
                        type: "text",
                        text: "Menu",
                        marks: [{ type: "link", attrs: { href: "https://example.com/menu" } }],
                      },
                      { type: "text", text: " <script>alert(1)</script>" },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const html = render(guide, "00000000-0000-4000-8000-000000000009");
    expect(html).toContain(
      "Tu anfitrión podría recibir una comisión u otro beneficio de este lugar.",
    );
    expect(html).not.toContain("javascript:alert");
    expect(html).toContain(
      'href="https://example.com/menu" rel="noopener noreferrer nofollow" target="_blank"',
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("Todavía no está traducido.");
    expect(html).toContain('lang="en"');
  });

  it("hides the language switch when the guide has one language", () => {
    const html = render({ ...base, languages: ["es"] });
    expect(html).not.toContain("data-switch-locale");
  });

  it("shows the emergency number with a call link", async () => {
    const html = await (await fixtureHandler()(get(`/g/${FIXTURE_PUBLIC_ID}/en/emergency`))).text();
    expect(html).toContain('href="tel:911"');
    expect(html).toContain("Call 911");
  });
});
