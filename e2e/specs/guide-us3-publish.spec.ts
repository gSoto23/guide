import { expect, test, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 003 US3 (quickstart 4, T074): the publish check warns without blocking; publishing
 * creates version 1; a draft edit shows "unpublished changes" while the published preview keeps
 * version 1; version 2 is published, version 1 restored as the draft and published as version 3;
 * then the guide is unpublished. Readiness, left-out items, and agents are covered by the API
 * tests. All data is fictional.
 */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function signIn(page: Page, email: string) {
  await page.goto("/es/sign-in");
  await page.getByLabel("Tu email").fill(email);
  await page.getByRole("button", { name: "Enviarme un código" }).click();
  await expect(page).toHaveURL(/\/es\/verify/);
  await waitForSubject(email, "Tu código de Guidesk");
  await page.getByLabel("Código").fill(await latestCodeFor(email));
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/es\/onboarding/);
}

async function addText(page: Page, guideUrl: string, section: string, text: string) {
  await page.goto(guideUrl);
  await page.getByRole("link", { name: section, exact: true }).click();
  await page.getByRole("button", { name: "Agregar texto" }).click();
  const editor = page.getByRole("textbox", { name: "Escribe para tus huéspedes…" }).last();
  await editor.click();
  const saved = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/guide/items/"),
  );
  await editor.pressSequentially(text);
  expect((await saved).ok()).toBe(true);
  await expect(page.getByText("Guardando…")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText(/^Sin guardar/)).toHaveCount(0);
}

async function publish(page: Page, guideUrl: string, number: number) {
  await page.goto(guideUrl);
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await page.getByRole("button", { name: "Publicar ahora" }).click();
  await expect(page.getByText(`Publicaste la versión ${number}.`)).toBeVisible();
  await expect(page.getByText(`Los huéspedes ven la versión ${number}.`)).toBeVisible();
}

test("quickstart 4: publish, edit, preview, restore, and unpublish", async ({ page }) => {
  test.setTimeout(240_000);
  page.on("dialog", (dialog) => void dialog.accept());
  await signIn(page, uniqueEmail("guide-us3"));

  await page.goto("/es/properties/new");
  await page.getByRole("link", { name: /Empezar desde cero/ }).click();
  await page.getByLabel(/^Nombre de la propiedad/).fill("Casa Garza");
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 789");
  await page.getByLabel(/^Ciudad/).fill("Tamarindo");
  await page.getByLabel(/^Máximo de huéspedes/).fill("4");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(page.getByRole("heading", { name: "Casa Garza" })).toBeVisible();
  await page.getByRole("link", { name: "Abrir la guía" }).click();
  await expect(page.getByRole("heading", { name: "Guía de Casa Garza" })).toBeVisible();
  const guideUrl = page.url();
  await expect(page.getByText("Borrador", { exact: true })).toBeVisible();

  // The check warns about missing essentials and off-platform booking, without blocking (FR-050).
  await addText(page, guideUrl, "Normas de la casa", "Reserva directo conmigo por WhatsApp.");
  await page.goto(guideUrl);
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Publicar la guía" });
  await expect(dialog.getByText(/pide reservar o pagar fuera de la plataforma/)).toBeVisible();
  await expect(dialog.getByText(/^Falta: /).first()).toBeVisible();
  await expect(dialog.getByText("Todo el contenido está revisado.")).toBeVisible();
  await dialog.getByRole("button", { name: "Publicar ahora" }).click();
  await expect(page.getByText("Publicaste la versión 1.")).toBeVisible();
  await expect(page.getByText("Publicada", { exact: true })).toBeVisible();

  // A draft edit never reaches guests (FR-052, SC-009).
  await addText(page, guideUrl, "Salida", "Deja las llaves sobre la mesa del comedor.");
  await page.goto(guideUrl);
  await expect(page.getByText("Publicada · cambios sin publicar")).toBeVisible();
  await page.getByRole("link", { name: "Vista previa" }).click();
  await expect(page.getByRole("heading", { name: "Vista previa" })).toBeVisible();
  await expect(page.getByText("Deja las llaves sobre la mesa del comedor.")).toBeVisible();
  await page.getByRole("link", { name: "Publicada", exact: true }).click();
  await expect(page.getByText("Reserva directo conmigo por WhatsApp.")).toBeVisible();
  await expect(page.getByText("Deja las llaves sobre la mesa del comedor.")).toHaveCount(0);
  await page.getByRole("link", { name: "Inglés" }).click();
  await expect(page).toHaveURL(/lang=en/);
  await expect(page.getByRole("article")).toHaveAttribute("lang", "en");

  // Version 2, restore version 1, publish it as version 3 (FR-055).
  await publish(page, guideUrl, 2);
  await page.getByRole("link", { name: "Versiones" }).click();
  await expect(page.getByRole("heading", { name: "Versiones publicadas" })).toBeVisible();
  const second = page.getByRole("listitem").filter({ hasText: "Versión 2" });
  await expect(second.getByText("La ven los huéspedes")).toBeVisible();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Versión 1" })
    .getByRole("button", { name: "Restaurar como borrador" })
    .click();
  await expect(page.getByText("Restauraste la versión 1 como borrador.")).toBeVisible();
  await expect(page.getByText("Publicada · cambios sin publicar")).toBeVisible();
  await page.getByRole("link", { name: "Salida", exact: true }).click();
  await expect(page.getByText("Deja las llaves sobre la mesa del comedor.")).toHaveCount(0);
  await publish(page, guideUrl, 3);

  // Unpublish (FR-056).
  await page.getByRole("button", { name: "Dejar de publicar" }).click();
  await expect(page.getByText("La guía ya no está publicada.")).toBeVisible();
  await expect(page.getByText("No publicada", { exact: true })).toBeVisible();
});
