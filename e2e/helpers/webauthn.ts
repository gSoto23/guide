import type { Page } from "@playwright/test";

/**
 * Adds a virtual platform authenticator with user verification to a Chromium page, so passkey
 * registration and sign-in can run in CI (research R14).
 */
export async function addVirtualAuthenticator(page: Page): Promise<() => Promise<void>> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  const { authenticatorId } = await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return async () => {
    await client.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
  };
}
