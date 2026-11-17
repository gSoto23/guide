import { expect, test, type Browser, type Page } from "@playwright/test";
import { latestCodeFor, waitForSubject } from "../helpers/mailpit";

/**
 * Feature 002 US4 on a phone viewport (quickstart 9, T088), with `PMS_MODE=fixtures` and
 * `PMS_BEDS24=true`: connect Beds24 with the fixture invite code, import all but one listing, see
 * the progress and the results, confirm the imported properties, and disconnect. The fixtures are
 * synthetic (packages/integrations/fixtures/beds24); no request leaves the machine.
 */
const INVITE = "FIXTURE-BEDS24-INVITE";

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

test("quickstart 9: connect Beds24, import, confirm, and disconnect", async ({ browser }) => {
  test.setTimeout(180_000);
  const email = uniqueEmail("us4-owner");
  const page = await newPage(browser);
  const outside: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname !== "localhost") outside.push(url.hostname);
  });
  await page.goto("/es/sign-in");
  await signInWithEmail(page, email);
  await expect(page).toHaveURL(/\/es\/onboarding/);

  // Connecting needs a recent sign-in, which this fresh session has (FR-027).
  await page.goto("/es/properties/new");
  await page.getByRole("link", { name: /Importar desde tu PMS/ }).click();
  await expect(page.getByRole("heading", { name: "Importar desde tu PMS" })).toBeVisible();
  const beds24 = page.getByRole("radio", { name: "Beds24" });
  if (await beds24.count()) await beds24.check();
  await page.getByLabel("Código de invitación").fill(INVITE);
  await page.getByRole("button", { name: "Conectar" }).click();

  // Every listing fits the Free plan's 2 slots at most; unselect one and import the rest.
  await expect(page.getByRole("heading", { name: "Elige qué importar" })).toBeVisible();
  const boxes = page.getByRole("checkbox");
  expect(await boxes.count()).toBeGreaterThanOrEqual(2);
  const checked = page.getByRole("checkbox", { checked: true });
  await expect(checked).toHaveCount(2);
  await checked.last().uncheck();
  await page.getByRole("button", { name: "Importar 1 anuncio" }).click();

  // The run page shows the progress, then the result per listing (FR-029).
  await expect(page).toHaveURL(/\/es\/properties\/imports\//);
  await expect(page.getByText("La importación terminó")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/^(Creada|Necesita datos)$/)).toHaveCount(1);
  await waitForSubject(email, "Terminó tu importación desde Beds24");

  // "Confirm all" moves imported properties with complete facts to ready (FR-004).
  await page.goto("/es/properties");
  const confirmAll = page.getByRole("button", { name: "Confirmar todas" });
  if (await confirmAll.count()) {
    await confirmAll.click();
    await expect(page.getByText(/propiedad confirmada/)).toBeVisible();
  }
  await expect(page.getByText("De Beds24").first()).toBeVisible();

  // Disconnect: Beds24's token is revoked and Guidesk's copy deleted (FR-036).
  await page.goto("/es/settings/integrations");
  await page.getByRole("button", { name: "Desconectar" }).click();
  await page.getByRole("button", { name: "Desconectar" }).last().click();
  await expect(page.getByText(/^Desconectado\./)).toBeVisible({ timeout: 30_000 });
  expect(outside, "requests outside Guidesk").toEqual([]);
});

test("quickstart 9 with Hostex: properties arrive needing details", async ({ browser }) => {
  test.setTimeout(180_000);
  const page = await newPage(browser);
  await page.goto("/es/sign-in");
  await signInWithEmail(page, uniqueEmail("us4-hostex"));
  await expect(page).toHaveURL(/\/es\/onboarding/);

  await page.goto("/es/properties/new/pms?provider=hostex");
  await page.getByLabel("Token de acceso").fill("FIXTURE-HOSTEX-TOKEN");
  await page.getByRole("button", { name: "Conectar" }).click();
  await expect(page.getByRole("heading", { name: "Elige qué importar" })).toBeVisible();
  await page.getByRole("button", { name: /^Importar \d+ anuncios?$/ }).click();

  await expect(page.getByText("La importación terminó")).toBeVisible({ timeout: 60_000 });
  // Hostex gives no time zone, times, or capacity for most listings (research R7).
  await expect(page.getByText("Necesita datos").first()).toBeVisible();
  await page.goto("/es/properties");
  await expect(page.getByText(/^Falta: /).first()).toBeVisible();
});
