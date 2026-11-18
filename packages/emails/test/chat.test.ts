import { describe, expect, it } from "vitest";
import { renderChatQuietSummary } from "../src/chat/notices.js";

/** The quiet hours summary (feature 007 T027, contracts/emails.md). Fictional data. */
const details = {
  propertyName: "Casa Colibrí",
  conversations: [
    {
      reason: "draft_ready" as const,
      guestMessage: "¿Dónde puedo parquear el carro esta noche?",
      link: "https://app.guidesk.test/es/properties/p1/conversations/c1",
    },
    {
      reason: "not_confident" as const,
      guestMessage: "x".repeat(400),
      link: "https://app.guidesk.test/es/properties/p1/conversations/c2",
    },
  ],
};

describe("chat.quiet_summary", () => {
  it.each(["es", "en"] as const)(
    "renders in %s with every waiting conversation and portal links only",
    async (locale) => {
      const email = await renderChatQuietSummary(locale, details);
      expect(email.subject).toContain("Casa Colibrí");
      expect(email.subject).toContain("2");
      for (const body of [email.html, email.text]) {
        expect(body).toContain("parquear");
        expect(body).toContain("conversations/c1");
        expect(body).toContain("conversations/c2");
        expect(body).not.toContain("x".repeat(130));
        const links = (body.match(/https?:\/\/[^\s"<]+/g) ?? []).filter(
          (link) => !link.startsWith("http://www.w3.org/"),
        );
        expect(links.every((link) => link.startsWith("https://app.guidesk.test/"))).toBe(true);
      }
    },
  );

  it("uses the singular for one conversation", async () => {
    const email = await renderChatQuietSummary("en", {
      ...details,
      conversations: details.conversations.slice(0, 1),
    });
    expect(email.subject).toBe("1 guest is waiting at Casa Colibrí");
  });
});
