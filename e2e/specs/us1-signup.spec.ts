import { expect, test } from "@playwright/test";
import { latestCodeFor } from "../helpers/mailpit";

/** Quickstart V1–V3 (spec 001 US1, T035). */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function signUpWithEmail(page: import("@playwright/test").Page, email: string) {
  await page.goto("/es/sign-in");
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  const code = await latestCodeFor(email);
  await page.getByLabel("Código").fill(code);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/es\/onboarding/);
}

test("V1 + V3: email sign-up, manager onboarding, first-property step", async ({ page }) => {
  const started = Date.now();
  await signUpWithEmail(page, uniqueEmail("ana"));

  await page.getByLabel("Más de 10").check();
  await page.getByLabel("¿Usas un sistema de gestión (PMS)?").selectOption("hostaway");
  await page.getByLabel("¿En qué país están tus propiedades?").selectOption("CR");
  await page.getByRole("button", { name: "Continuar" }).click();

  await expect(page).toHaveURL(/\/es\/properties\/new\?path=manager/);
  await expect(page.getByRole("heading", { name: "Crea tu primera propiedad" })).toBeVisible();
  await expect(page.getByText("Trae todas tus propiedades de una vez.")).toBeVisible();
  // SC-001: under 2 minutes (well under, in automation).
  expect(Date.now() - started).toBeLessThan(120_000);
});

test("V2: skipping onboarding still reaches the first-property step", async ({ page }) => {
  await signUpWithEmail(page, uniqueEmail("emily"));
  await page.getByRole("button", { name: "Omitir por ahora" }).click();
  await expect(page).toHaveURL(/\/es\/properties\/new\?path=individual/);
  await expect(page.getByText("Empieza con lo que ya escribiste en tu anuncio.")).toBeVisible();
});

test("signed-out visitors are sent to sign-in", async ({ page }) => {
  await page.goto("/es/onboarding");
  await expect(page).toHaveURL(/\/es\/sign-in/);
});
