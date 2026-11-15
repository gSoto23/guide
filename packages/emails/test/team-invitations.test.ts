import { describe, expect, it } from "vitest";
import { renderInvitation, renderInvitationAccepted } from "../src/index.js";

describe("team invitation emails (T076)", () => {
  it("renders the invitation with the accept link and expiry", async () => {
    const email = await renderInvitation("es", {
      workspaceName: "Casa Marco",
      inviterName: "Marco",
      role: "agent",
      acceptUrl: "https://portal.example/es/invite/abc",
      expiresInDays: 7,
    });
    expect(email.subject).toBe("Te invitaron a Casa Marco en Guidesk");
    expect(email.text).toContain("Marco te invitó a Casa Marco");
    expect(email.text).toContain("agente");
    expect(email.html).toContain("https://portal.example/es/invite/abc");
    expect(email.text).toContain("7 días");
  });

  it("escapes names instead of rendering markup", async () => {
    const email = await renderInvitation("en", {
      workspaceName: "<b>Evil</b>",
      inviterName: null,
      role: "admin",
      acceptUrl: "https://portal.example/en/invite/abc",
      expiresInDays: 7,
    });
    expect(email.html).not.toContain("<b>Evil</b>");
    expect(email.text).toContain("Someone invited you");
  });

  it("tells the inviter who joined", async () => {
    const email = await renderInvitationAccepted("en", {
      memberName: "Lucía",
      workspaceName: "Casa Marco",
      role: "agent",
    });
    expect(email.subject).toBe("Lucía joined Casa Marco");
  });
});
