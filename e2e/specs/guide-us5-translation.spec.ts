import { expect, test, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 003 US5 (quickstart 6, T097), with the fake model, whose translations start with
 * "[en]": a Spanish text is translated to English within 2 minutes (SC-005), marked reviewed,
 * goes out of date when the original changes, is kept as is, and is translated again. All data
 * is fictional.
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

const ORIGINAL = "El aire acondicionado se enciende con el control remoto.";
const CHANGED = "El aire acondicionado se enciende con el control blanco.";

test("quickstart 6: machine translation, review, out of date, keep, and translate again", async ({
  page,
}) => {
  test.setTimeout(300_000);
  page.on("dialog", (dialog) => void dialog.accept());
  await signIn(page, uniqueEmail("guide-us5"));

  await page.goto("/es/properties/new");
  await page.getByRole("link", { name: /Empezar desde cero/ }).click();
  await page.getByLabel(/^Nombre de la propiedad/).fill("Casa Pelícano");
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 654");
  await page.getByLabel(/^Ciudad/).fill("Jacó");
  await page.getByLabel(/^Máximo de huéspedes/).fill("4");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(page.getByRole("heading", { name: "Casa Pelícano" })).toBeVisible();
  await page.getByRole("link", { name: "Abrir la guía" }).click();
  await expect(page.getByRole("heading", { name: "Guía de Casa Pelícano" })).toBeVisible();
  const guideUrl = page.url();

  // A Spanish text.
  await page.getByRole("link", { name: "Electrodomésticos y cómo usarlos", exact: true }).click();
  await page.getByRole("button", { name: "Agregar texto" }).click();
  const editor = page.getByRole("textbox", { name: "Escribe para tus huéspedes…" });
  await editor.click();
  const firstSave = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/guide/items/"),
  );
  await editor.pressSequentially(ORIGINAL);
  expect((await firstSave).ok()).toBe(true);
  await expect(page.getByText("Guardando…")).toHaveCount(0, { timeout: 10_000 });
  const saved = Date.now();

  // Translated within 2 minutes of the last save (SC-005).
  await page.goto(guideUrl);
  await page.getByRole("link", { name: "Traducciones" }).click();
  await expect(page.getByRole("heading", { name: "Traducciones" })).toBeVisible();
  const row = page.locator(".translation-row").filter({ hasText: "El aire acondicionado" });
  await expect(row.getByText(`[en] ${ORIGINAL}`)).toBeVisible({ timeout: 120_000 });
  expect(Date.now() - saved).toBeLessThan(120_000);
  await expect(row.getByText("Traducción automática")).toBeVisible();

  // Reviewed by the host (FR-045).
  await row.getByRole("button", { name: "Marcar revisada" }).click();
  await expect(row.getByText("Revisada", { exact: true })).toBeVisible();

  // The original changes: the reviewed translation is out of date, never retranslated (FR-046).
  await page.goto(guideUrl);
  await page.getByRole("link", { name: "Electrodomésticos y cómo usarlos", exact: true }).click();
  const source = page.getByRole("textbox", { name: "Escribe para tus huéspedes…" });
  await source.click();
  await page.keyboard.press("ControlOrMeta+a");
  const changeSaved = page.waitForResponse(
    (response) => response.request().method() === "PATCH" && response.url().includes("/guide/items/"),
  );
  await source.pressSequentially(CHANGED);
  expect((await changeSaved).ok()).toBe(true);
  await expect(page.getByText("Guardando…")).toHaveCount(0, { timeout: 10_000 });
  await page.goto(guideUrl);
  await page.getByRole("link", { name: "Traducciones" }).click();
  const changed = page.locator(".translation-row").filter({ hasText: CHANGED });
  await expect(changed.getByText(/Desactualizada/)).toBeVisible();
  await expect(changed.getByText(`[en] ${ORIGINAL}`)).toBeVisible();

  // Keep it as is, then translate it again.
  await changed.getByRole("button", { name: "Mantener como está" }).click();
  await expect(changed.getByText("Revisada", { exact: true })).toBeVisible();
  await changed.getByRole("button", { name: "Traducir de nuevo" }).click();
  await expect(changed.getByText("Traduciendo…")).toBeVisible();
  await expect(changed.getByText(`[en] ${CHANGED}`)).toBeVisible({ timeout: 120_000 });
  await expect(changed.getByText("Traducción automática")).toBeVisible();
});
