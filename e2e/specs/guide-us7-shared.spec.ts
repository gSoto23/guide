import { expect, test, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 003 US7 (quickstart 8, T114): a Checkout shared block published to two published guides
 * gives each a new version and shows as "Shared"; an override keeps its own copy and learns that
 * the shared version changed after the next publish; excluding removes the block from a draft.
 * All data is fictional.
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

/** Creates a blank property and publishes its guide; returns the guide's URL. */
async function publishedProperty(page: Page, name: string, city: string): Promise<string> {
  await page.goto("/es/properties/new");
  await page.getByRole("link", { name: /Empezar desde cero/ }).click();
  await page.getByLabel(/^Nombre de la propiedad/).fill(name);
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 111");
  await page.getByLabel(/^Ciudad/).fill(city);
  await page.getByLabel(/^Máximo de huéspedes/).fill("4");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await page.getByRole("link", { name: "Abrir la guía" }).click();
  await expect(page.getByRole("heading", { name: `Guía de ${name}` })).toBeVisible();
  const url = page.url();
  await page.getByRole("button", { name: "Publicar", exact: true }).click();
  await page.getByRole("button", { name: "Publicar ahora" }).click();
  await expect(page.getByText("Publicaste la versión 1.")).toBeVisible();
  return url;
}

/** Waits for the fan-out job to give a guide its new version. */
async function expectVersion(page: Page, guideUrl: string, number: number) {
  await expect(async () => {
    await page.goto(`${guideUrl}/versions`);
    await expect(
      page.getByRole("listitem").filter({ hasText: `Versión ${number}` }),
    ).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
}

async function openCheckout(page: Page, guideUrl: string) {
  await page.goto(guideUrl);
  await page.getByRole("link", { name: "Salida", exact: true }).click();
}

test("quickstart 8: shared content, override, and exclude", async ({ page }) => {
  test.setTimeout(300_000);
  page.on("dialog", (dialog) => void dialog.accept());
  await signIn(page, uniqueEmail("guide-us7"));
  const north = await publishedProperty(page, "Casa Norte", "Liberia");
  const south = await publishedProperty(page, "Casa Sur", "Golfito");

  // A Checkout block, published to both guides (FR-058, FR-060).
  // Feature 015: on phones, Shared content lives under More in the bottom bar.
  await page.getByRole("button", { name: "Más" }).click();
  await page.getByRole("link", { name: "Contenido compartido" }).click();
  await expect(page.getByRole("heading", { name: "Contenido compartido" })).toBeVisible();
  await page.getByRole("button", { name: "Crear bloque" }).click();
  await page.getByLabel("Sección").selectOption("checkout");
  await page.getByLabel("Nombre del bloque").fill("Pasos de salida");
  await page.getByRole("button", { name: "Crear bloque" }).click();
  await expect(page.getByRole("heading", { name: "Pasos de salida" })).toBeVisible();
  await page.getByRole("button", { name: "Agregar texto" }).click();
  const editor = page.getByRole("textbox", { name: "Escribe el contenido compartido…" });
  await editor.click();
  await editor.pressSequentially("Dejen las llaves en la mesa.");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Dejen las llaves en la mesa.")).toBeVisible();
  const blockUrl = page.url();
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText(/Se actualizarán 2 guías publicadas/)).toBeVisible();

  for (const guideUrl of [north, south]) {
    await expectVersion(page, guideUrl, 2);
    await openCheckout(page, guideUrl);
    await expect(page.getByText("Compartido: Pasos de salida").first()).toBeVisible();
    await expect(page.getByText("Dejen las llaves en la mesa.")).toBeVisible();
  }

  // An override keeps its own copy (FR-059).
  await page.getByRole("button", { name: "Sobrescribir para esta propiedad" }).click();
  await expect(page.getByText("Usas una copia propia de «Pasos de salida».")).toBeVisible();

  // The block changes and is published again: only the inheriting guide changes (FR-061).
  await page.goto(blockUrl);
  await page.getByRole("button", { name: "Agregar texto" }).click();
  const second = page.getByRole("textbox", { name: "Escribe el contenido compartido…" });
  await second.click();
  await second.pressSequentially("Apaguen el aire acondicionado.");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("Apaguen el aire acondicionado.")).toBeVisible();
  await page.getByRole("button", { name: "Publicar" }).click();
  await expect(page.getByText(/Se actualizarán 1 guía publicada/)).toBeVisible();
  await expectVersion(page, north, 3);
  await openCheckout(page, south);
  await expect(page.getByText("La versión compartida cambió desde que hiciste tu copia.")).toBeVisible();
  await expect(page.getByText("Apaguen el aire acondicionado.")).toHaveCount(0);

  // Excluding removes the block from the first guide's draft.
  await openCheckout(page, north);
  await expect(page.getByText("Apaguen el aire acondicionado.")).toBeVisible();
  await page.getByRole("button", { name: "Excluir de esta propiedad" }).click();
  await expect(page.getByText("Excluiste «Pasos de salida» de esta propiedad.")).toBeVisible();
  await expect(page.getByText("Apaguen el aire acondicionado.")).toHaveCount(0);
});
