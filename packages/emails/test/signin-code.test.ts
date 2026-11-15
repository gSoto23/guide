import { describe, expect, it } from "vitest";
import { localeFromAcceptLanguage, renderSignInCode } from "../src/index.js";

describe("auth.signin_code (T040)", () => {
  it("renders the code in Spanish and English", async () => {
    const es = await renderSignInCode("es", "482913");
    const en = await renderSignInCode("en", "482913");
    expect(es.subject).toBe("Tu código de Guidesk");
    expect(es.text).toContain("482913");
    expect(es.text).toContain("10 minutos");
    expect(en.subject).toBe("Your Guidesk code");
    expect(en.text).toContain("10 minutes");
  });

  it("contains no images or tracking pixels", async () => {
    const { html } = await renderSignInCode("es", "482913");
    expect(html).not.toMatch(/<img/i);
  });
});

describe("localeFromAcceptLanguage", () => {
  it("picks the best supported language", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9,es;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("fr-FR,es;q=0.5")).toBe("es");
    expect(localeFromAcceptLanguage("de-DE")).toBeNull();
    expect(localeFromAcceptLanguage(undefined)).toBeNull();
  });
});
