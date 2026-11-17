import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 002 US6 on a phone viewport (quickstart 11, T115): duplicate a property with a stay,
 * then remove the original after the typed name, with its upcoming stay shown first, and restore
 * it from the removed list. All data is fictional.
 */
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ baseURL: "http://localhost:3000", locale: "es-CR" });
  return context.newPage();
}

async function signInWithEmail(page: Page, email: string) {
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
}

test("quickstart 11: duplicate, remove with the typed name, and restore", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPage(browser);
  await page.goto("/es/sign-in");
  await signInWithEmail(page, uniqueEmail("us6-owner"));
  await expect(page).toHaveURL(/\/es\/onboarding/);

  // The original, with an upcoming stay added by hand.
  await page.goto("/es/properties/new/blank");
  await page.getByLabel(/^Nombre de la propiedad/).fill("Torre Mar 4B");
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 123");
  await page.getByLabel(/^Ciudad/).fill("Sámara");
  await page.getByLabel(/^Máximo de huéspedes/).fill("4");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(page.getByRole("heading", { name: "Torre Mar 4B" })).toBeVisible();
  const original = page.url();
  await page.getByRole("button", { name: "Agregar una estadía a mano" }).click();
  await page.getByLabel(/^Fecha de entrada/).fill(day(5));
  await page.getByLabel(/^Fecha de salida/).fill(day(8));
  await page.getByLabel("Cantidad de huéspedes").fill("2");
  await page.getByRole("button", { name: "Agregar estadía" }).click();
  await expect(page.getByText("Estadía agregada.")).toBeVisible();

  // The copy opens in the confirmation step, with "Copia de …" and an empty address (FR-043).
  await page.getByRole("link", { name: "Duplicar" }).click();
  await expect(page.getByText("Copia de «Torre Mar 4B»")).toBeVisible();
  await expect(page.getByText(/No se copian la dirección, los calendarios/)).toBeVisible();
  await expect(page.getByLabel(/^Nombre de la propiedad/)).toHaveValue("Copia de Torre Mar 4B");
  await expect(page.getByLabel(/^Calle y número/)).toHaveValue("");
  await expect(page.getByLabel(/^Máximo de huéspedes/)).toHaveValue("4");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 125");
  await page.getByLabel(/^Ciudad/).fill("Sámara");
  await page.getByRole("button", { name: "Crear la copia" }).click();
  await expect(page.getByRole("heading", { name: "Copia de Torre Mar 4B" })).toBeVisible();
  await expect(page.getByText("Copia", { exact: true }).first()).toBeVisible();
  // None of the original's stays came along.
  await expect(page.locator(".stay-list > li")).toHaveCount(0);

  // Removing asks for the typed name and shows the upcoming stay first (FR-044).
  await page.goto(original);
  await page.getByRole("button", { name: "Eliminar propiedad" }).click();
  const zone = page.getByRole("region", { name: "Eliminar esta propiedad" });
  await expect(zone.getByText("Tiene 1 estadía próxima:")).toBeVisible();
  const remove = zone.getByRole("button", { name: "Eliminar", exact: true });
  await expect(remove).toBeDisabled();
  await zone.getByLabel("Escribe «Torre Mar 4B» para confirmar").fill("Torre Mar");
  await expect(remove).toBeDisabled();
  await zone.getByLabel("Escribe «Torre Mar 4B» para confirmar").fill("Torre Mar 4B");
  await remove.click();

  // It waits 30 days in the removed list, and no longer counts toward the plan (FR-045).
  await expect(page).toHaveURL(/\/es\/properties\?view=removed/);
  await expect(page.getByRole("heading", { name: "Propiedades eliminadas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Torre Mar 4B" })).toBeVisible();
  await expect(page.getByText(/^Se borra en (29|30) días$/)).toBeVisible();
  await page.getByRole("button", { name: "Restaurar" }).click();
  await expect(page.getByText("Restauraste «Torre Mar 4B».")).toBeVisible();
  await expect(page.getByText("No tienes propiedades eliminadas.")).toBeVisible();

  await page.goto("/es/properties");
  await expect(page.getByText("2 de 2 propiedades")).toBeVisible();
  await expect(page.getByRole("link", { name: /Torre Mar 4B/ })).toHaveCount(2);
});
