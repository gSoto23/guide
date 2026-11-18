import { readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 003 US1 on a phone viewport (quickstart 1 and 2, T045): a property from listing text
 * gets its guide draft with content placed and labeled by source; the owner edits text, adds a
 * photo, approves, hides a section, and adds a custom section; pasted markup never runs. All data
 * is fictional.
 */
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

const LISTING = [
  "Casa Colibrí frente al mar",
  "",
  "Casa luminosa a dos cuadras de la playa.",
  "Parqueo para un carro frente a la casa.",
  "Supermercado a 300 metros.",
  "Entrada a las 3 pm, salida a las 11 am. Máximo 4 huéspedes.",
  "",
  "Reglas de la casa",
  "No se permiten fiestas. Silencio después de las 10 pm.",
  "",
  "Comodidades",
  "Wi-Fi",
  "Piscina",
].join("\n");

const ENTRANCE = readFileSync(
  new URL("../../apps/sandbox/test/fixtures/media/entrance-gps.jpg", import.meta.url),
);

test("quickstart 1 and 2: the draft from listing text, editing, media, approval, and sections", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const page = await newPage(browser);
  await page.goto("/es/sign-in");
  await signInWithEmail(page, uniqueEmail("guide-us1"));
  await expect(page).toHaveURL(/\/es\/onboarding/);

  // A property from listing text (feature 002 US2, fake model).
  await page.goto("/es/properties/new");
  await page.getByRole("link", { name: /Pegar tu anuncio/ }).click();
  await page.getByRole("textbox", { name: "Texto del anuncio" }).fill(LISTING);
  await page.getByRole("button", { name: "Leer mi anuncio" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu anuncio" })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page.getByLabel(/^Nombre de la propiedad/)).toHaveValue(
    "Casa Colibrí frente al mar",
  );
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 123");
  await page.getByLabel(/^Ciudad/).fill("Sámara");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(page.getByRole("heading", { name: "Casa Colibrí frente al mar" })).toBeVisible();

  // The guide draft: nine sections, content placed and labeled (FR-001, FR-004, FR-005).
  await page.getByRole("link", { name: "Abrir la guía" }).click();
  await expect(
    page.getByRole("heading", { name: "Guía de Casa Colibrí frente al mar" }),
  ).toBeVisible();
  await expect(page.getByText(/^Completa al \d+ %$/)).toBeVisible();
  for (const name of [
    "Llegada y acceso",
    "Wi-Fi",
    "Normas de la casa",
    "Parqueo y transporte",
    "Salida",
  ]) {
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  }
  await expect(page.getByText("Preparando el borrador desde tu anuncio…")).toHaveCount(0, {
    timeout: 60_000,
  });

  await page.getByRole("link", { name: "Parqueo y transporte", exact: true }).click();
  await expect(page.getByText("De tu anuncio · Por revisar").first()).toBeVisible();
  await page.getByRole("button", { name: "Aprobar todo" }).click();
  await expect(page.getByText("De tu anuncio · Por revisar")).toHaveCount(0);

  // Text, saved by itself after typing stops (FR-008, FR-011).
  await page.getByRole("link", { name: "Volver a la guía" }).click();
  await page.getByRole("link", { name: "Electrodomésticos y cómo usarlos", exact: true }).click();
  await page.getByRole("button", { name: "Agregar texto" }).click();
  const editor = page.getByRole("textbox", { name: "Escribe para tus huéspedes…" });
  await editor.click();
  await editor.pressSequentially("El aire acondicionado se enciende con el control remoto.");
  await expect(page.getByText("Guardando…")).toHaveCount(0, { timeout: 10_000 });
  await page.reload();
  await expect(
    page.getByText("El aire acondicionado se enciende con el control remoto."),
  ).toBeVisible();

  // A photo, cleaned by the worker before it shows (FR-009, AC-SEC-010).
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles({
    name: "entrada.jpg",
    mimeType: "image/jpeg",
    buffer: ENTRANCE,
  });
  await expect(page.locator("figure img")).toBeVisible({ timeout: 90_000 });

  // A pasted script never runs or stays (AC-SEC-008).
  let alerted = false;
  page.on("dialog", async (dialog) => {
    if (dialog.message() === "1") alerted = true;
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Agregar texto" }).click();
  const second = page.getByRole("textbox", { name: "Escribe para tus huéspedes…" }).last();
  await second.click();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData(
      "text/html",
      '<p>Hola <img src=x onerror="alert(1)"><script>alert(1)</script></p>',
    );
    document.activeElement?.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: data, bubbles: true }),
    );
  });
  await expect(page.getByText("Guardando…")).toHaveCount(0, { timeout: 10_000 });
  expect(alerted).toBe(false);
  await expect(page.locator(".guide-editor-content img")).toHaveCount(0);

  // Hide a default section; add a custom one (FR-002).
  await page.getByRole("link", { name: "Volver a la guía" }).click();
  await page.getByRole("link", { name: "Parqueo y transporte", exact: true }).click();
  await page.getByRole("button", { name: "Ocultar sección" }).click();
  await expect(page.getByText(/Esta sección está oculta/)).toBeVisible();
  await page.getByRole("link", { name: "Volver a la guía" }).click();
  await page.getByRole("button", { name: "Agregar sección propia" }).click();
  await page.getByLabel("Nombre de la sección").fill("Piscina");
  await page.getByRole("button", { name: "Crear" }).click();
  await expect(page.getByRole("link", { name: "Piscina", exact: true })).toBeVisible();
});
