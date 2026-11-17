import { expect, test, type Browser, type Page } from "@playwright/test";
import { CERTIFICATE_DIR, startIcalServer, type IcalServer } from "../helpers/ical-server";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 002 US3 on a phone viewport (quickstart 7 and 8, T072): a feed read through the
 * isolated feed reader shows its stays, a "may be a block" stay stays hidden after a refresh, and
 * a direct booking is added by hand. Needs the API and worker started with
 * SANDBOX_TEST_ALLOW_HOST=localhost and SANDBOX_TEST_CA_FILE set to the fixture server's CA file
 * (see e2e/helpers/ical-server.ts); both are refused in production. All data is fictional.
 */
const FEED = "us3-colibri";
let server: IcalServer;

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test.beforeAll(async () => {
  server = await startIcalServer(CERTIFICATE_DIR);
  server.setFeed(FEED, [
    { uid: "res-1@fixture.test", start: day(3), end: day(6), summary: "Reserved" },
    { uid: "block-1@fixture.test", start: day(9), end: day(11), summary: "Not available" },
    // No label: the feed cannot say whether it is a reservation (FR-022).
    { uid: "unlabeled-1@fixture.test", start: day(14), end: day(16) },
  ]);
});

test.afterAll(async () => {
  await server?.close();
});

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

test("quickstart 7 and 8: a calendar feed, a hidden block, and a direct stay", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const page = await newPage(browser);
  await page.goto("/es/sign-in");
  await signInWithEmail(page, uniqueEmail("us3-owner"));
  await expect(page).toHaveURL(/\/es\/onboarding/);

  await page.goto("/es/properties/new/blank");
  await page.getByLabel(/^Nombre de la propiedad/).fill("Casa Colibrí");
  await page.getByLabel(/^País/).selectOption("CR");
  await page.getByLabel(/^Calle y número/).fill("Calle Ficticia 123");
  await page.getByLabel(/^Ciudad/).fill("Sámara");
  await page.getByLabel(/^Máximo de huéspedes/).fill("4");
  await expect(page.getByLabel(/^Zona horaria/)).toHaveValue("America/Costa_Rica");
  await page.getByRole("button", { name: "Guardar propiedad" }).click();
  await expect(page.getByRole("heading", { name: "Casa Colibrí" })).toBeVisible();

  // The feed is checked when saved and shows what it found; the block is not a stay (FR-021).
  await page.getByRole("button", { name: "Agregar un calendario" }).click();
  await page.getByLabel("Enlace para exportar el calendario (iCal)").fill(server.url(FEED));
  await page.getByLabel("Canal", { exact: true }).selectOption("airbnb");
  await page.getByRole("button", { name: "Revisar y guardar" }).click();
  await expect(page.getByText(/Encontramos 2 estadías próximas/)).toBeVisible({ timeout: 20_000 });
  // The link is never shown again, only its masked end (FR-025).
  await expect(page.getByText(server.url(FEED))).toHaveCount(0);
  await expect(page.getByText(/Enlace que termina en/)).toBeVisible();

  const stays = page.locator(".stay-list > li");
  await expect(stays).toHaveCount(2);
  await expect(page.getByText("Puede ser un bloqueo")).toHaveCount(1);

  // Hiding a "may be a block" stay survives the next refresh (FR-022, FR-023).
  await page.getByRole("button", { name: "Ocultar" }).click();
  await expect(page.getByText(/Estadía oculta/)).toBeVisible();
  await expect(stays).toHaveCount(1);
  const hitsBefore = server.hits(FEED);
  await page.getByRole("button", { name: "Actualizar ahora" }).click();
  await expect(page.getByText(/Actualizando tus calendarios/)).toBeVisible();
  await expect.poll(() => server.hits(FEED), { timeout: 30_000 }).toBeGreaterThan(hitsBefore);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Próximas estadías" })).toBeVisible();
  await expect(stays).toHaveCount(1);
  await expect(page.getByText("Puede ser un bloqueo")).toHaveCount(0);

  // A direct booking added by hand joins the same list (FR-052).
  await page.getByRole("button", { name: "Agregar una estadía a mano" }).click();
  await page.getByLabel(/^Fecha de entrada/).fill(day(20));
  await page.getByLabel(/^Fecha de salida/).fill(day(23));
  await page.getByLabel("Cantidad de huéspedes").fill("2");
  await page.getByRole("button", { name: "Agregar estadía" }).click();
  await expect(page.getByText("Estadía agregada.")).toBeVisible();
  await expect(stays).toHaveCount(2);
  await expect(stays.filter({ hasText: "Directa" })).toHaveCount(1);
});
