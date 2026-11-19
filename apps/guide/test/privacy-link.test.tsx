import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fixtureGuide } from "../src/fixtures/guide.js";
import { HomePage, clientTexts } from "../src/pages/guide-pages.js";
import { translator } from "../src/i18n.js";
import { fixtureHandler, FIXTURE_PUBLIC_ID, get } from "./helpers.js";

/** Feature 014 FR-010: guests can read the privacy policy from the guide. */
const assets = {
  script: "/a.js",
  style: "/a.css",
  chatScript: "/c.js",
  chatStyle: "/c.css",
  publicDir: "/tmp",
};

describe("privacy link in the guide", () => {
  it("ends the home with a link to the portal's privacy policy in the guide's language", () => {
    const guide = fixtureGuide(FIXTURE_PUBLIC_ID, "en")!;
    const html = renderToString(
      <HomePage
        t={translator("en")}
        locale="en"
        assets={assets}
        guide={guide}
        privacyHref="https://app.example.com/en/privacy"
      />,
    );
    expect(html).toContain(
      '<a href="https://app.example.com/en/privacy" target="_blank" rel="noopener">Privacy</a>',
    );
    expect(html).toContain('data-privacy-href="https://app.example.com/en/privacy"');
  });

  it("gives the chat panel its text", () => {
    expect(clientTexts(translator("es"))["privacy.link"]).toBe("Privacidad");
  });

  it("is built by the handler from the portal origin and keeps the guide unindexed", async () => {
    const response = await fixtureHandler()(get(`/g/${FIXTURE_PUBLIC_ID}/es`));
    const html = await response.text();
    expect(html).toMatch(/href="http:\/\/localhost:3000\/es\/privacy"/);
    expect(html).toContain('<meta name="robots" content="noindex, nofollow"/>');
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
