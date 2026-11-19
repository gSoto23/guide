import { describe, expect, it } from "vitest";
import { publicCatalog } from "../lib/public/catalog";
import { legalDate } from "../lib/public/legal";
import { planCards } from "../lib/public/plans";
import { alternates, publicUrls, robotsAllow } from "../lib/public/routes";
import { isEmail, publicSettings } from "../lib/public/settings";
import { complete, fill, usableLines } from "../lib/public/text";

describe("public settings (feature 014 research R4)", () => {
  it("uses the defaults when nothing is set", () => {
    expect(publicSettings({})).toEqual({
      contactEmail: null,
      companyName: "Guidesk",
      portalUrl: "http://localhost:3000",
    });
  });

  it("reads a valid contact, a company, and the portal origin", () => {
    expect(
      publicSettings({
        CONTACT_EMAIL: " hola@example.com ",
        COMPANY_NAME: "Example S.A.",
        PORTAL_URL: "https://app.example.com/",
      }),
    ).toEqual({
      contactEmail: "hola@example.com",
      companyName: "Example S.A.",
      portalUrl: "https://app.example.com",
    });
  });

  it("treats an invalid contact or an overlong company as unset", () => {
    const settings = publicSettings({
      CONTACT_EMAIL: "not an email",
      COMPANY_NAME: "x".repeat(121),
    });
    expect(settings.contactEmail).toBeNull();
    expect(settings.companyName).toBe("Guidesk");
  });

  it("checks email shapes without a regular expression", () => {
    expect(isEmail("a@b.co")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail("a@@b.co")).toBe(false);
    expect(isEmail("@b.co")).toBe(false);
    expect(isEmail("a b@c.co")).toBe(false);
  });
});

describe("public text helpers", () => {
  it("fills known placeholders and keeps unknown ones", () => {
    expect(fill("© {year} {company} {other}", { year: "2026", company: "Guidesk" })).toBe(
      "© 2026 Guidesk {other}",
    );
  });

  it("drops lines whose placeholders have no value (no contact address)", () => {
    expect(complete("Write to {email}.", {})).toBe(false);
    expect(usableLines(["One.", "Write to {email}.", "{company} two."], { company: "G" })).toEqual([
      "One.",
      "G two.",
    ]);
  });

  it("shows markup in a setting as text, not as markup (AC-SEC-007)", () => {
    // The helper returns plain strings; React renders them as text nodes.
    expect(fill("{company}", { company: "<b>x</b>" })).toBe("<b>x</b>");
  });
});

describe("plans on the home page (feature 014 FR-002)", () => {
  it("come from the product's limits and fees", () => {
    const cards = planCards("es", publicCatalog("es"));
    expect(cards.map((card) => card.id)).toEqual(["free", "pro", "business"]);
    expect(cards[0]).toMatchObject({
      price: "USD 0",
      lines: ["2 propiedades activas", "100 respuestas de IA al mes", "1 puesto"],
    });
    expect(cards[0]?.fee).toMatch(/10\s?%/);
    expect(cards[1]?.price).toBe("Precio por anunciar");
    expect(cards[1]?.lines).toEqual([
      "Propiedades sin límite",
      "300 respuestas de IA al mes por propiedad activa, compartidas",
      "3 puestos",
    ]);
    expect(cards[1]?.fee).toMatch(/7\s?%/);
    expect(cards[2]?.lines[2]).toBe("Puestos sin límite");
    expect(cards[2]?.fee).toMatch(/5\s?%/);
  });

  it("read in English", () => {
    const cards = planCards("en", publicCatalog("en"));
    expect(cards[0]?.lines).toEqual(["2 active properties", "100 AI replies a month", "1 seat"]);
    expect(cards[1]?.price).toBe("Price to be announced");
  });
});

describe("public routes (feature 014 contracts/public-pages.md)", () => {
  it("list the six public URLs", () => {
    expect(publicUrls("https://app.example.com").map((entry) => entry.url)).toEqual([
      "https://app.example.com/es",
      "https://app.example.com/en",
      "https://app.example.com/es/privacy",
      "https://app.example.com/en/privacy",
      "https://app.example.com/es/terms",
      "https://app.example.com/en/terms",
    ]);
  });

  it("give each page's alternates", () => {
    expect(alternates("https://x.test", "/terms")).toEqual({
      es: "https://x.test/es/terms",
      en: "https://x.test/en/terms",
    });
  });

  it("allow only the public paths in robots", () => {
    expect(robotsAllow()).toEqual([
      "/es$",
      "/en$",
      "/es/privacy",
      "/en/privacy",
      "/es/terms",
      "/en/terms",
    ]);
  });
});

describe("legal date", () => {
  it("is written in the reader's language", () => {
    expect(legalDate("es", "2026-11-19")).toBe("19 de noviembre de 2026");
    expect(legalDate("en", "2026-11-19")).toBe("November 19, 2026");
  });
});
