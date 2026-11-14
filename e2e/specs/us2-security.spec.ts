import { expect, test, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";
import { addVirtualAuthenticator } from "../helpers/webauthn";

/** Quickstart V5 and V7 (spec 001 US2, T052). */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function signInWithEmail(page: Page, email: string) {
  await page.goto("/es/sign-in");
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/es\/onboarding/);
}

test("V5: register a passkey, sign out, and sign in with it", async ({ page }) => {
  const removeAuthenticator = await addVirtualAuthenticator(page);
  await signInWithEmail(page, uniqueEmail("passkey"));

  await page.goto("/es/settings/security");
  await page.getByRole("button", { name: "Agregar passkey" }).click();
  await expect(page.getByText("Passkey agregada.")).toBeVisible();

  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page).toHaveURL(/\/es\/sign-in/);

  await page.getByRole("button", { name: "Entrar con passkey" }).click();
  await expect(page).toHaveURL(/\/es\/onboarding/);
  await removeAuthenticator();
});

test("V7: a sign-in from a new device sends an alert email", async ({ browser }) => {
  const email = uniqueEmail("newdevice");
  const first = await browser.newContext({ baseURL: "http://localhost:3000", locale: "es-CR" });
  await signInWithEmail(await first.newPage(), email);
  await first.close();

  const second = await browser.newContext({ baseURL: "http://localhost:3000", locale: "es-CR" });
  await signInWithEmail(await second.newPage(), email);
  await second.close();

  expect(await waitForSubject(email, "Nuevo inicio de sesión")).toContain("Nuevo inicio de sesión en Guidesk");
});
