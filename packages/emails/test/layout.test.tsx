import { describe, expect, it } from "vitest";
import { EmailLayout, renderEmail, toEmailLocale } from "../src/index.js";

describe("EmailLayout", () => {
  it("renders HTML and plain text with the security footer in the user's language", async () => {
    const rendered = await renderEmail(
      <EmailLayout locale="en" preview="Test" security>
        <p>Hello</p>
      </EmailLayout>,
    );
    expect(rendered.html).toContain('lang="en"');
    expect(rendered.text).toContain("If this wasn't you");
  });

  it("defaults unknown languages to Spanish", () => {
    expect(toEmailLocale(undefined)).toBe("es");
    expect(toEmailLocale("fr")).toBe("es");
    expect(toEmailLocale("en")).toBe("en");
  });
});
