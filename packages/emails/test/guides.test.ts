import { describe, expect, it } from "vitest";
import { renderRevealLimit } from "../src/guides/notices.js";

/** The reveal-limit email (feature 003 T063, FR-018, contracts/emails.md). */
const details = {
  memberName: "Alba Admin",
  memberEmail: "alba@example.com",
  reveals: 20,
  propertyNames: ["Casa Colibrí", "Torre Mar 4B"],
  at: new Date("2026-11-17T15:00:00Z"),
  securityLogLink: "https://app.guidesk.test/es/settings/security-log",
  sessionsLink: "https://app.guidesk.test/es/settings/members",
};

describe("guides.reveal_limit", () => {
  it.each(["es", "en"] as const)(
    "renders in %s without any code, value, or outside link",
    async (locale) => {
      const email = await renderRevealLimit(locale, details);
      expect(email.subject).toContain("Alba Admin");
      for (const body of [email.html, email.text]) {
        expect(body).toContain("Casa Colibrí");
        expect(body).toContain("20");
        expect(body).not.toMatch(/4821|lockbox code is|código es/i);
        // The doctype's DTD address is not a link.
        const links = (body.match(/https?:\/\/[^\s"<]+/g) ?? []).filter(
          (link) => !link.startsWith("http://www.w3.org/"),
        );
        expect(links.every((link) => link.startsWith("https://app.guidesk.test/"))).toBe(true);
      }
    },
  );
});
