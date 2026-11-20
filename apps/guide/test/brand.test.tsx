import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixtureGuide } from "../src/fixtures/guide.js";
import { translator } from "../src/i18n.js";
import { HomePage, SectionPage } from "../src/pages/guide-pages.js";
import {
  ExchangePage,
  OfflinePage,
  RateLimitedPage,
  UnavailablePage,
} from "../src/pages/simple-pages.js";
import { FIXTURE_PUBLIC_ID } from "./helpers.js";

/** Feature 015: icon tiles, the Free credit, link previews, and illustrated status pages. */
const assets = {
  script: "/a.js",
  style: "/a.css",
  chatScript: "/c.js",
  chatStyle: "/c.css",
  publicDir: "/tmp",
};
const PORTAL = "https://app.example.com";

function chrome(locale: "es" | "en") {
  return { t: translator(locale), locale, assets, portalUrl: PORTAL };
}

function home(locale: "es" | "en", credit: boolean) {
  const guide = { ...fixtureGuide(FIXTURE_PUBLIC_ID, locale)!, credit };
  return { guide, html: renderToString(<HomePage {...chrome(locale)} guide={guide} />) };
}

describe("guide tiles (FR-010, FR-014)", () => {
  it("gives every tile an icon, the whole title, and a chevron", () => {
    const { guide, html } = home("es", false);
    const tiles = html.match(/<a class="tile"[^>]*>.*?<\/a>/g) ?? [];
    const expected =
      guide.sections.length + (guide.extras.visible ? 1 : 0) + (guide.explore.visible ? 1 : 0);
    expect(tiles).toHaveLength(expected);
    for (const tile of tiles) {
      expect(tile).toContain('class="tile-icon"');
      expect(tile).toMatch(/<span class="tile-title">[^<]+<\/span>/);
      expect(tile).toContain("tile-chevron");
      expect(tile).toContain('aria-hidden="true"');
    }
  });

  it("puts the section icon in the section page title", () => {
    const guide = fixtureGuide(FIXTURE_PUBLIC_ID, "es")!;
    const section = guide.sections[0]!;
    const html = renderToString(
      <SectionPage {...chrome("es")} guide={guide} sectionId={section.id} />,
    );
    expect(html).toMatch(/<h1 class="title title-with-icon"><span class="tile-icon"><svg/);
  });
});

describe("Free-plan credit (FR-022)", () => {
  it("shows the mark and the credit, linking to the public home in the guide's language", () => {
    const { html } = home("en", true);
    expect(html).toContain('<p class="credit">');
    expect(html).toContain(`href="${PORTAL}/en" target="_blank" rel="noopener"`);
    expect(html).toContain("Made with Guidesk");
    expect(html).toContain('class="brand-mark"');
  });

  it("is absent on paid plans", () => {
    const { html } = home("es", false);
    expect(html).not.toContain('class="credit"');
    expect(html).not.toContain("Hecho con Guidesk");
  });
});

describe("link previews (FR-023)", () => {
  it("names the property with a fixed description and the branded image", () => {
    const { guide, html } = home("es", false);
    expect(html).toContain(`<meta property="og:title" content="${guide.propertyName}"/>`);
    expect(html).toContain(
      '<meta property="og:description" content="Guía digital de tu estadía"/>',
    );
    expect(html).toContain(`<meta property="og:image" content="${PORTAL}/brand/og-es.png"/>`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"/>');
  });

  it("gives stay links a generic preview with no stay data", () => {
    const html = renderToString(<ExchangePage {...chrome("en")} />);
    expect(html).toContain('<meta property="og:title" content="Your stay guide"/>');
    expect(html).toContain(`<meta property="og:image" content="${PORTAL}/brand/og-en.png"/>`);
  });
});

describe("status pages (FR-019, FR-021)", () => {
  it.each([
    ["unavailable", UnavailablePage],
    ["rate limited", RateLimitedPage],
    ["offline", OfflinePage],
  ])("%s shows an illustration and the small mark, and no preview", (_name, Page) => {
    const html = renderToString(<Page {...chrome("es")} />);
    expect(html).toContain('class="illustration status-art"');
    expect(html).toContain('<p class="status-mark">');
    expect(html).not.toContain("og:title");
  });
});

describe("cover photo (feature 016 FR-004, FR-006)", () => {
  const cover = {
    url: `/api/v1/guest/media/${FIXTURE_PUBLIC_ID}/m1/large`,
    smallUrl: `/api/v1/guest/media/${FIXTURE_PUBLIC_ID}/m1/small`,
    width: 1600,
    height: 900,
    alt: "Fachada con palmeras",
  };

  it("shows the cover above the title with a fixed size and the host's description", () => {
    const guide = { ...fixtureGuide(FIXTURE_PUBLIC_ID, "es")!, cover };
    const html = renderToString(<HomePage {...chrome("es")} guide={guide} />);
    expect(html).toMatch(/<img class="cover" src="[^"]+\/small"[^>]*alt="Fachada con palmeras"/);
    expect(html).toContain('width="1600" height="900"');
    expect(html.indexOf('class="cover"')).toBeLessThan(html.indexOf('<h1 class="title">'));
  });

  it("uses the cover as the preview image on the guide's origin", () => {
    const guide = { ...fixtureGuide(FIXTURE_PUBLIC_ID, "es")!, cover };
    const html = renderToString(
      <HomePage {...chrome("es")} guideUrl="https://g.example.com" guide={guide} />,
    );
    expect(html).toContain(
      `<meta property="og:image" content="https://g.example.com${cover.url}"/>`,
    );
    expect(html).not.toContain("/brand/og-es.png");
  });

  it("keeps the branded preview image without a cover", () => {
    const { html } = home("es", false);
    expect(html).toContain(`<meta property="og:image" content="${PORTAL}/brand/og-es.png"/>`);
    expect(html).not.toContain('class="cover"');
  });
});
