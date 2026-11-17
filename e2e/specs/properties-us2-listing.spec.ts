import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 002 US2 on a phone viewport with the fake model (LLM_MODE=fake, T053): a URL alone asks
 * for text, a pasted code is removed before the AI, the review labels each part "From your
 * listing" until the host edits it, and the confirmed property keeps those labels. All data is
 * fictional.
 */
const LISTING = [
  "Casa Colibrí frente al mar",
  "",
  "Casa de dos habitaciones a 50 metros de la playa en Sámara. Terraza con hamacas.",
  "Entrada a las 3 pm, salida a las 11 am. Máximo 4 huéspedes.",
  "Código de la puerta: 3907",
  "",
  "Reglas de la casa",
  "No fumar adentro. Silencio después de las 10 pm.",
  "",
  "Comodidades",
  "Wi-Fi",
  "Aire acondicionado",
  "Lavadora",
].join("\n");

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

test("quickstart 4 to 6: paste a listing, review it, and confirm the property", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newPage(browser);
  const outside: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost") outside.push(url.hostname);
  });
  await page.goto("/es/sign-in");
  await signInWithEmail(page, uniqueEmail("us2-owner"));
  await expect(page).toHaveURL(/\/es\/onboarding/);

  await page.goto("/es/properties/new");
  await page.getByRole("link", { name: /Pegar tu anuncio/ }).click();
  await expect(page.getByRole("heading", { name: "Pegar tu anuncio" })).toBeVisible();
  await expect(page.getByText(/No incluyas códigos de puerta/)).toBeVisible();

  // A URL alone is never opened: the host is asked for the text (FR-011).
  const box = page.getByRole("textbox", { name: "Texto del anuncio" });
  await box.fill("https://www.airbnb.com/rooms/12345678");
  await page.getByRole("button", { name: "Leer mi anuncio" }).click();
  await expect(page.getByText(/No abrimos enlaces/)).toBeVisible();

  // The door code is removed before the AI reads the text, and the host is told (FR-012).
  await box.fill(LISTING);
  await page.getByRole("button", { name: "Leer mi anuncio" }).click();
  await expect(page.getByText(/Quitamos 1 código de puerta/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Revisa tu anuncio" })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByText("De tu anuncio")).toHaveCount(4);
  await expect(page.getByText(/3907/)).toHaveCount(0);

  // Editing a part changes its label (US2 scenario 7).
  const description = page.getByRole("textbox", { name: "Descripción" });
  await description.fill(`${await description.inputValue()} Ideal para familias.`);
  await expect(page.getByText("Editado por ti")).toBeVisible();
  await expect(page.getByText("De tu anuncio")).toHaveCount(3);

  // The confirmation step starts from what the listing said.
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(
    page.getByRole("heading", { name: "Confirma los datos de la propiedad" }),
  ).toBeVisible();
  await expect(page.getByLabel(/^Nombre de la propiedad/)).toHaveValue(
    "Casa Colibrí frente al mar",
  );
  await expect(page.getByLabel(/^Hora de entrada/)).toHaveValue("15:00");
  await expect(page.getByLabel(/^Máximo de huéspedes/)).toHaveValue("4");
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 123");
  await page.getByLabel(/^Ciudad/).fill("Sámara");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();

  // The property keeps each part with its label; nothing is published (FR-018).
  await expect(page.getByRole("heading", { name: "Casa Colibrí frente al mar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contenido del anuncio" })).toBeVisible();
  await expect(page.getByText("Editado por ti")).toBeVisible();
  await expect(page.getByText(/Ideal para familias/)).toBeVisible();
  await page.getByRole("button", { name: "Aprobar" }).first().click();
  await expect(page.getByText("Aprobado")).toBeVisible();
  expect(outside, "requests outside Guidesk").toEqual([]);
});
