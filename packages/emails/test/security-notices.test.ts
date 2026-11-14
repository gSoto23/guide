import { describe, expect, it } from "vitest";
import { renderFactorChanged, renderLockout, renderNewDevice } from "../src/index.js";

describe("security notice emails (T058, T059, T064)", () => {
  it("renders the new-device alert with device and location", async () => {
    const email = await renderNewDevice("en", {
      device: "Chrome on Android",
      location: "Samara, CR",
      at: new Date(0),
    });
    expect(email.subject).toBe("New sign-in to Guidesk");
    expect(email.text).toContain("Chrome on Android");
    expect(email.text).toContain("Samara, CR");
    expect(email.text).toContain("If this wasn't you");
  });

  it("renders the lockout notice in Spanish", async () => {
    const email = await renderLockout("es", 15);
    expect(email.text).toContain("15 minutos");
  });

  it("renders factor changes", async () => {
    const email = await renderFactorChanged("es", "passkey_added", "Safari on iOS");
    expect(email.text).toContain("Se agregó una passkey.");
  });
});
