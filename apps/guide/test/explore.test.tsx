import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GuestExplore } from "@guidesk/contracts";
import { fixtureExplore, fixtureGuide } from "../src/fixtures/guide.js";
import { contentSecurityPolicy } from "../src/headers.js";
import { translator } from "../src/i18n.js";
import { allowImages, ExperiencePage, ExplorePage } from "../src/pages/explore-pages.js";
import { fixtureHandler, FIXTURE_PUBLIC_ID, get } from "./helpers.js";

/**
 * Explore pages (feature 009 T013, T019): tips first, the disclosure at the top, on every card, and
 * on the detail, partner text as text, the Book link through Guidesk's click address in a new tab
 * without a referrer, the English-only note, and partner photo hosts in the CSP. Synthetic data.
 */
const assets = {
  script: "/a.js",
  style: "/a.css",
  chatScript: "/c.js",
  chatStyle: "/c.css",
  publicDir: "/tmp",
};

function input(language: "es" | "en", explore: GuestExplore) {
  return {
    t: translator(language),
    locale: language,
    assets,
    guide: fixtureGuide(FIXTURE_PUBLIC_ID, language)!,
    explore,
  };
}

const hostile: GuestExplore = {
  ...fixtureExplore(FIXTURE_PUBLIC_ID, "es")!,
  categories: [
    {
      category: "water",
      experiences: [
        {
          ref: "viator-EVIL1",
          partner: "viator",
          partnerName: "Viator",
          category: "water",
          title: '<img src=x onerror="alert(1)">Tour',
          description: '<script>alert(1)</script> <a href="https://evil.example">x</a>',
          includes: null,
          durationMinutes: 150,
          priceFrom: 79.5,
          currency: "USD",
          rating: 4.86,
          reviewCount: 312,
          image: { url: "https://media.example-cdn.test/a.jpg", width: 480, height: 320 },
          language: "en",
          machineTranslated: false,
        },
      ],
    },
  ],
};

const count = (html: string, text: string) => html.split(text).length - 1;

describe("Explore (feature 009 US1, US3)", () => {
  it("shows tips first, then categories, with the disclosure at the top and on every card", () => {
    const explore = fixtureExplore(FIXTURE_PUBLIC_ID, "es")!;
    const html = renderToString(<ExplorePage {...input("es", explore)} />);
    const disclosure = "Guidesk podría recibir una comisión si reservas, sin costo extra para ti.";
    const cards = explore.categories.flatMap((group) => group.experiences).length;
    expect(count(html, disclosure)).toBe(cards + 1);
    expect(html.indexOf("Recomendaciones de tu anfitrión")).toBeLessThan(
      html.indexOf("Experiencias cerca de Sámara"),
    );
    expect(html).toContain(">Tours</h3>");
    expect(html).toContain(">Actividades en el agua</h3>");
    expect(html).toContain(`href="/g/${FIXTURE_PUBLIC_ID}/es/explore/viator-FIXTURE1"`);
  });

  it("renders partner text as text and books through Guidesk's address in a new tab", () => {
    const card = hostile.categories[0]!.experiences[0]!;
    const html = renderToString(<ExperiencePage {...input("es", hostile)} card={card} />);
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain('onerror="alert');
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain(
      `href="/api/v1/guest/guides/${FIXTURE_PUBLIC_ID}/experiences/viator-EVIL1/go?lang=es"`,
    );
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer nofollow"');
    expect(html).toMatch(/<img[^>]*referrerpolicy="no-referrer"/i);
    expect(html).toContain("Reservar en Viator");
    expect(html).toContain("Guidesk podría recibir una comisión");
    expect(html).toContain("Descripción disponible solo en inglés.");
    expect(html).toContain('width="480"');
    expect(html).toContain('height="320"');
    expect(html).toContain("2 horas 30 min");
    expect(html).toContain("4,9 de 5 (312 reseñas)");
  });

  it("serves Explore and a detail through the router, and allows partner photo hosts in the CSP", async () => {
    const handle = fixtureHandler();
    const list = await handle(get(`/g/${FIXTURE_PUBLIC_ID}/en/explore`));
    expect(list.status).toBe(200);
    const listHtml = await list.text();
    expect(listHtml).toContain(
      "Guidesk may earn a commission if you book, at no extra cost to you.",
    );
    const detail = await handle(get(`/g/${FIXTURE_PUBLIC_ID}/en/explore/viator-FIXTURE1`));
    expect(detail.status).toBe(200);
    expect(await detail.text()).toContain("Book on Viator");
    const missing = await handle(get(`/g/${FIXTURE_PUBLIC_ID}/en/explore/viator-NOPE`));
    expect(missing.status).toBe(302);
    expect(missing.headers.get("location")).toBe(`/g/${FIXTURE_PUBLIC_ID}/en/explore`);
    const home = await (await handle(get(`/g/${FIXTURE_PUBLIC_ID}/en`))).text();
    expect(home).toContain(`href="/g/${FIXTURE_PUBLIC_ID}/en/explore"`);
    expect(list.headers.get("content-security-policy")).toContain("https://media.example-cdn.test");
    expect(
      contentSecurityPolicy({
        apiUrl: "http://api",
        mediaOrigin: null,
        secure: false,
        fixtures: false,
        edgeSecret: null,
        experienceImageOrigins: [],
        portalUrl: "http://localhost:3000",
        guideUrl: null,
      }),
    ).toContain("img-src 'self' data:;");
  });

  it("keeps partner photos only from allowed hosts", () => {
    const filtered = allowImages(hostile, ["https://other-cdn.example"]);
    expect(filtered.categories[0]!.experiences[0]!.image).toBeNull();
    const kept = allowImages(hostile, ["https://media.example-cdn.test"]);
    expect(kept.categories[0]!.experiences[0]!.image).not.toBeNull();
  });
});
